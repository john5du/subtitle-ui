package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func TestHandleNormalizePlanAndApply(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte("<movie><title>Movie A</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	legacyPath := filepath.Join(movieDir, "movie-a.CHS.srt")
	if err := os.WriteFile(legacyPath, []byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"), 0o644); err != nil {
		t.Fatalf("write subtitle: %v", err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = service.Close() }()
	if status := service.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := mustListVideosPage(t, service, "movie", 20)
	if len(page.Items) != 1 || len(page.Items[0].Subtitles) != 1 {
		t.Fatalf("expected one video+subtitle, got %+v", page)
	}
	video := page.Items[0]
	server := NewServer(service, "")

	req := httptest.NewRequest(http.MethodPost, "/api/videos/"+video.ID+"/subtitles/normalize/plan", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("plan status %d body=%s", rec.Code, rec.Body.String())
	}
	var plan domain.SubtitleNormalizePlan
	if err := json.Unmarshal(rec.Body.Bytes(), &plan); err != nil {
		t.Fatalf("decode plan: %v", err)
	}
	if len(plan.Items) != 1 {
		t.Fatalf("expected 1 plan item, got %+v", plan.Items)
	}

	body, err := json.Marshal(map[string]any{
		"items": []domain.SubtitleNormalizeApplyItem{{
			VideoID:    video.ID,
			SubtitleID: video.Subtitles[0].ID,
			ToPath:     plan.Items[0].ToPath,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/videos/"+video.ID+"/subtitles/normalize/apply", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply status %d body=%s", rec.Code, rec.Body.String())
	}
	var result domain.SubtitleNormalizeApplyResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode apply: %v", err)
	}
	if result.Renamed != 1 {
		t.Fatalf("expected renamed=1, got %+v", result)
	}
	if _, err := os.Stat(legacyPath); !os.IsNotExist(err) {
		t.Fatalf("legacy path should be gone, err=%v", err)
	}
}

func TestHandleArchiveSubtitleEntries(t *testing.T) {
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	w, err := zw.Create("show.zh.srt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot: t.TempDir(),
		TVMediaRoot:    t.TempDir(),
		DatabaseURL:    store.TestDSN(t),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = service.Close() }()
	server := NewServer(service, "")

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", "pack.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(zipBuf.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/archives/subtitle-entries", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Entries []struct {
			FileName string `json:"fileName"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(payload.Entries) != 1 || !strings.Contains(payload.Entries[0].FileName, "show.zh.srt") {
		t.Fatalf("entries: %+v", payload.Entries)
	}
}

func TestHandleSubHDSearchDisabled(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte("<movie><title>Movie A</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatal(err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
		SubHDEnabled:   false,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = service.Close() }()
	if status := service.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := mustListVideosPage(t, service, "movie", 10)
	server := NewServer(service, "")
	req := httptest.NewRequest(http.MethodGet, "/api/videos/"+page.Items[0].ID+"/subtitles/providers/subhd/search", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", rec.Code, rec.Body.String())
	}
}
