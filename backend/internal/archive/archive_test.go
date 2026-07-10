package archive

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path"
	"strings"
	"testing"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestListAndExtractZip(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("inner/movie.zh.srt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"))
	_ = zw.Close()

	entries, err := ListSubtitleEntries(buf.Bytes(), "pack.zip")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].FileName != "movie.zh.srt" {
		t.Fatalf("entries=%+v", entries)
	}

	name, data, err := ExtractSubtitle(buf.Bytes(), "pack.zip", "")
	if err != nil {
		t.Fatal(err)
	}
	if name != "movie.zh.srt" || !strings.Contains(string(data), "hi") {
		t.Fatalf("name=%s data=%q", name, data)
	}
}

func TestExtractPreferredAndMultiple(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"a.srt", "b.srt"} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte("1\n00:00:01,000 --> 00:00:02,000\nx\n"))
	}
	_ = zw.Close()

	_, _, err := ExtractSubtitle(buf.Bytes(), "pack.zip", "")
	var multi *MultipleEntriesError
	if !errors.As(err, &multi) || len(multi.Entries) != 2 {
		t.Fatalf("want MultipleEntriesError, got %v", err)
	}

	name, _, err := ExtractSubtitle(buf.Bytes(), "pack.zip", "b.srt")
	if err != nil || name != "b.srt" {
		t.Fatalf("preferred: name=%s err=%v", name, err)
	}
}

func TestExtractSevenZipAndRAR(t *testing.T) {
	for _, tc := range []struct {
		file string
		want string
	}{
		{"../provider/subhd/testdata/single.7z", "movie.zh.srt"},
		{"../provider/subhd/testdata/single.rar", "movie.zh.srt"},
	} {
		data, err := os.ReadFile(tc.file)
		if err != nil {
			t.Fatal(err)
		}
		name, body, err := ExtractSubtitle(data, path.Base(tc.file), "")
		if err != nil {
			t.Fatalf("%s: %v", tc.file, err)
		}
		if path.Base(name) != tc.want {
			t.Fatalf("%s: got %s", tc.file, name)
		}
		if !strings.Contains(string(body), "hi") {
			t.Fatalf("%s: body %q", tc.file, body)
		}
	}

	data, err := os.ReadFile("../provider/subhd/testdata/multi.7z")
	if err != nil {
		t.Fatal(err)
	}
	name, body, err := ExtractSubtitle(data, "multi.7z", "movie.eng.srt")
	if err != nil {
		t.Fatal(err)
	}
	if path.Base(name) != "movie.eng.srt" || !strings.Contains(string(body), "eng") {
		t.Fatalf("got name=%s body=%q", name, body)
	}
}

func TestListZipGBKEntryNames(t *testing.T) {
	// Simulate Chinese pack: GBK filename, NonUTF8 (no ZIP UTF-8 flag).
	nameUTF8 := "史前战纪.2019.S03E01.简体&英语.srt"
	nameGBK, err := simplifiedchinese.GBK.NewEncoder().String(nameUTF8)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: nameGBK, Method: zip.Deflate, NonUTF8: true}
	w, err := zw.CreateHeader(h)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	entries, err := ListSubtitleEntries(buf.Bytes(), "pack.zip")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != nameUTF8 {
		t.Fatalf("want path %q, got %+v", nameUTF8, entries)
	}

	// JSON must round-trip the entry key (install uses the prepare path string).
	type wrap struct {
		Path string `json:"path"`
	}
	raw, err := json.Marshal(wrap{Path: entries[0].Path})
	if err != nil {
		t.Fatal(err)
	}
	var back wrap
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	extracted, err := ExtractAllSubtitles(buf.Bytes(), "pack.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := extracted[back.Path]; !ok {
		t.Fatalf("JSON path %q not in extracted keys %v", back.Path, keysOf(extracted))
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestUnsupportedAndNotArchive(t *testing.T) {
	data := []byte{0x1f, 0x8b, 0x08, 0x00}
	_, err := ListSubtitleEntries(data, "a.tar.gz")
	if err == nil || !errors.Is(err, ErrUnsupported) {
		t.Fatalf("want unsupported, got %v", err)
	}

	_, err = ListSubtitleEntries([]byte("plain srt"), "x.srt")
	if !errors.Is(err, ErrNotArchive) {
		t.Fatalf("want not archive, got %v", err)
	}
}
