package subhd

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"
	"time"
)

func TestParseSearchHTML(t *testing.T) {
	html := `
<!DOCTYPE html><html><body>
<h4>共 2 条 当前第 1 页</h4>
<div class="bg-white shadow-sm rounded-3 mb-4">
  <div class="row">
    <div class="col-2"><div class="pics">
      <img src="https://img.subhd.me/poster/douban/35575567_600.webp">
    </div></div>
    <div class="col-lg-10">
      <div class="float-start f16 fw-bold">
        <a class="link-dark align-middle" href='/a/bqpxFZ'>沙丘2</a>
      </div>
      <div class="view-text text-secondary">
        <a href='/a/bqpxFZ'>重调轴 Dune.Part.Two.2024.简体&amp;英文</a>
      </div>
      <div class="text-truncate py-2 f11">
        <span class="rounded p-1 me-1 text-white" style="background-color:#6f42c1">转载精修</span>
        <span class="p-1 fw-bold">双语</span>
        <span class="p-1 fw-bold">简体</span><span class="p-1 fw-bold">英语</span>
        <span class="p-1 text-secondary">ASS</span>
      </div>
      <div class="pt-2 text-secondary f12">
        <span class="align-text-top me-3">220k</span>
        <span class="align-text-top me-3">961</span>
      </div>
      <div class="pt-1 f12">发布人 <a class="fw-bold text-dark" href='/u/NickCollect'>NickCollect</a></div>
    </div>
  </div>
</div>
<div class="bg-white shadow-sm rounded-3 mb-4">
  <div class="row">
    <div class="col-lg-10">
      <div class="float-start f16 fw-bold">
        <a class="link-dark" href='/a/rvXzoC'>沙丘2</a>
      </div>
      <div class="view-text text-secondary">
        <a href='/a/rvXzoC'>BluRay SUP</a>
      </div>
      <div class="text-truncate py-2 f11">
        <span class="rounded p-1 me-1 text-white">官方字幕</span>
        <span class="p-1 fw-bold">英语</span>
        <span class="p-1 text-secondary">SUP</span>
      </div>
      <div class="pt-2">
        <span class="align-text-top me-3">8577k</span>
        <span class="align-text-top me-3">309</span>
      </div>
    </div>
  </div>
</div>
</body></html>`

	items := parseSearchHTML(html)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	a := items[0]
	if a.SID != "bqpxFZ" {
		t.Fatalf("sid: %q", a.SID)
	}
	if a.Title != "沙丘2" {
		t.Fatalf("title: %q", a.Title)
	}
	if !strings.Contains(a.Version, "Dune.Part.Two") {
		t.Fatalf("version: %q", a.Version)
	}
	if a.Format != "ASS" {
		t.Fatalf("format: %q", a.Format)
	}
	if !a.Installable {
		t.Fatal("ASS should be installable")
	}
	if a.SourceTag != "转载精修" {
		t.Fatalf("source: %q", a.SourceTag)
	}
	if a.Size != "220k" {
		t.Fatalf("size: %q", a.Size)
	}
	if a.Downloads != "961" {
		t.Fatalf("downloads: %q", a.Downloads)
	}
	if a.Publisher != "NickCollect" {
		t.Fatalf("publisher: %q", a.Publisher)
	}
	if a.DoubanID != "35575567" {
		t.Fatalf("douban: %q", a.DoubanID)
	}
	if got := strings.Join(a.Langs, ","); !strings.Contains(got, "简体") || !strings.Contains(got, "双语") {
		t.Fatalf("langs: %v", a.Langs)
	}

	b := items[1]
	if b.SID != "rvXzoC" {
		t.Fatalf("sid2: %q", b.SID)
	}
	if b.Format != "SUP" || b.Installable {
		t.Fatalf("SUP should not be installable: %+v", b)
	}
}

func TestSolveSVGKnownLengths(t *testing.T) {
	// Build synthetic svg with known path lengths from lengthMap (unique mappings).
	// Use simple d strings padded to exact length.
	mk := func(length int, startX string) string {
		// path tag must be >500 chars total; d length is what maps to letter
		d := strings.Repeat("1", length)
		// inject M and coords for sorting
		d = "M" + startX + " 10 " + d[len("M"+startX+" 10 "):]
		if len(d) < length {
			d = d + strings.Repeat("0", length-len(d))
		}
		if len(d) > length {
			d = d[:length]
		}
		tag := `<path fill="#000" d="` + d + `"/>`
		// ensure tag long enough (>500)
		if len(tag) <= 500 {
			pad := 501 - len(tag)
			tag = `<path fill="#000" data-pad="` + strings.Repeat("x", pad) + `" d="` + d + `"/>`
		}
		return tag
	}
	// 998 -> "1", 1082 -> "v", 1478 -> "T"
	svg := `<svg>` + mk(998, "10") + mk(1082, "40") + mk(1478, "70") + `</svg>`
	got := SolveSVG(svg)
	if got != "1vT" {
		t.Fatalf("SolveSVG got %q want 1vT (path lens %d %d %d)", got, 998, 1082, 1478)
	}
}

func TestDownloadSuccessAndCaptcha(t *testing.T) {
	var posts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/a/"):
			http.SetCookie(w, &http.Cookie{Name: "tk_1_abc", Value: "token", Path: "/", MaxAge: 300})
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>ok</html>"))
		case r.URL.Path == "/api/sub/down":
			posts++
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if posts == 1 {
				// return captcha svg with one unique-length path
				d := strings.Repeat("a", 998)
				d = "M5 10 " + d[len("M5 10 "):]
				if len(d) != 998 {
					d = (d + strings.Repeat("a", 998))[:998]
				}
				tag := `<path fill="red" d="` + d + `"/>`
				if len(tag) <= 500 {
					tag = `<path fill="red" data-x="` + strings.Repeat("z", 200) + `" d="` + d + `"/>`
				}
				svg := `<svg xmlns="http://www.w3.org/2000/svg">` + tag + `</svg>`
				_ = json.NewEncoder(w).Encode(map[string]any{
					"success": false,
					"pass":    false,
					"msg":     svg,
					"url":     nil,
				})
				return
			}
			if body["cap"] == "" {
				t.Errorf("expected captcha answer on second post")
			}
			url := "http://" + r.Host + "/file.ass"
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"pass":    true,
				"msg":     "验证通过",
				"url":     url,
			})
		case r.URL.Path == "/file.ass":
			w.Header().Set("Content-Disposition", `attachment; filename="demo.ass"`)
			_, _ = w.Write([]byte("[Script Info]\nTitle: demo\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := New(Options{
		Enabled:     true,
		BaseURL:     srv.URL,
		MinInterval: time.Millisecond,
		HTTPClient:  srv.Client(),
	})
	// ensure client uses test server transport
	c.client = srv.Client()

	dl, err := c.Download(context.Background(), "bqpxFZ")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if !strings.Contains(string(dl.Data), "Script Info") {
		t.Fatalf("data: %q", dl.Data)
	}
	if posts < 2 {
		t.Fatalf("expected captcha retry, posts=%d", posts)
	}
}

func TestDownloadRateLimited(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/a/") {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/api/sub/down" {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": false,
				"error":   "Internal Server Error",
				"message": "服务器内部错误，请稍后再试！",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := New(Options{Enabled: true, BaseURL: srv.URL, MinInterval: time.Millisecond, HTTPClient: srv.Client()})
	c.client = srv.Client()
	_, err := c.Download(context.Background(), "x")
	if err != ErrRateLimited {
		t.Fatalf("want ErrRateLimited, got %v", err)
	}
}

func TestResolveInstallableZip(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("inner/movie.zh.srt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"))
	_ = zw.Close()

	dl := &DownloadedFile{SID: "s1", FileName: "pack.zip", Data: buf.Bytes()}
	got, err := ResolveInstallable(dl, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Ext != ".srt" || path.Base(got.FileName) != "movie.zh.srt" {
		t.Fatalf("got %+v", got)
	}
}

func TestResolveInstallableRAR(t *testing.T) {
	data := []byte("Rar!\x1a\x07\x00fake")
	_, err := ResolveInstallable(&DownloadedFile{FileName: "a.rar", Data: data}, "")
	if err == nil || !strings.Contains(err.Error(), "unsupported archive") {
		t.Fatalf("want unsupported archive, got %v", err)
	}
}

func TestDisabled(t *testing.T) {
	c := New(Options{Enabled: false})
	_, err := c.Search(context.Background(), "x", 1)
	if err != ErrDisabled {
		t.Fatalf("got %v", err)
	}
}

func TestSearchViaServer(t *testing.T) {
	html := `<div class="bg-white shadow-sm rounded-3 mb-4">
<a href='/a/Ab12Cd'>Title</a>
<div class="view-text"><a href='/a/Ab12Cd'>Ver</a></div>
<span class="p-1 text-secondary">SRT</span>
</div>`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/search/") {
			t.Fatalf("path %s", r.URL.Path)
		}
		fmt.Fprint(w, html)
	}))
	defer srv.Close()
	c := New(Options{Enabled: true, BaseURL: srv.URL, HTTPClient: srv.Client()})
	c.client = srv.Client()
	page, err := c.Search(context.Background(), "Dune", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].SID != "Ab12Cd" {
		t.Fatalf("%+v", page)
	}
}
