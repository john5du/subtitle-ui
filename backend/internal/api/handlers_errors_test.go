package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/store"
)

func newErrorPathFixture(t *testing.T) (*app.Service, *Server, string) {
	t.Helper()
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte("<movie><title>Movie A</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	t.Cleanup(func() { _ = service.Close() })
	if status := service.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := mustListVideosPage(t, service, "movie", 10)
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	return service, NewServer(service, ""), page.Items[0].ID
}

func serveAPI(handler http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestGetVideoHTTPNotFoundVsStoreError(t *testing.T) {
	service, server, videoID := newErrorPathFixture(t)
	handler := server.Handler()

	missing := serveAPI(handler, http.MethodGet, "/api/videos/missing-video-id")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing video status=%d body=%s", missing.Code, missing.Body.String())
	}

	ok := serveAPI(handler, http.MethodGet, "/api/videos/"+videoID)
	if ok.Code != http.StatusOK {
		t.Fatalf("existing video status=%d body=%s", ok.Code, ok.Body.String())
	}

	_ = service.Close()
	storeFail := serveAPI(handler, http.MethodGet, "/api/videos/"+videoID)
	if storeFail.Code != http.StatusInternalServerError {
		t.Fatalf("store error should be 500, got %d body=%s", storeFail.Code, storeFail.Body.String())
	}
}

func TestListVideosHTTPStoreError(t *testing.T) {
	service, server, _ := newErrorPathFixture(t)
	handler := server.Handler()

	ok := serveAPI(handler, http.MethodGet, "/api/videos?mediaType=movie")
	if ok.Code != http.StatusOK {
		t.Fatalf("list videos status=%d body=%s", ok.Code, ok.Body.String())
	}

	_ = service.Close()
	storeFail := serveAPI(handler, http.MethodGet, "/api/videos?mediaType=movie")
	if storeFail.Code != http.StatusInternalServerError {
		t.Fatalf("list store error should be 500, got %d body=%s", storeFail.Code, storeFail.Body.String())
	}
}

func TestLogsHTTPNotFoundVsStoreError(t *testing.T) {
	service, server, _ := newErrorPathFixture(t)
	handler := server.Handler()

	missing := serveAPI(handler, http.MethodGet, "/api/logs/missing-op-id")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing log status=%d body=%s", missing.Code, missing.Body.String())
	}

	rollbackMissing := httptest.NewRequest(http.MethodPost, "/api/logs/missing-op-id/rollback", nil)
	rollbackRec := httptest.NewRecorder()
	handler.ServeHTTP(rollbackRec, rollbackMissing)
	if rollbackRec.Code != http.StatusNotFound {
		t.Fatalf("missing rollback status=%d body=%s", rollbackRec.Code, rollbackRec.Body.String())
	}

	ok := serveAPI(handler, http.MethodGet, "/api/logs?page=1&pageSize=8")
	if ok.Code != http.StatusOK {
		t.Fatalf("list logs status=%d body=%s", ok.Code, ok.Body.String())
	}

	_ = service.Close()
	listFail := serveAPI(handler, http.MethodGet, "/api/logs?page=1&pageSize=8")
	if listFail.Code != http.StatusInternalServerError {
		t.Fatalf("list logs store error should be 500, got %d body=%s", listFail.Code, listFail.Body.String())
	}

	getFail := serveAPI(handler, http.MethodGet, "/api/logs/missing-op-id")
	if getFail.Code != http.StatusInternalServerError {
		t.Fatalf("get log store error should be 500, got %d body=%s", getFail.Code, getFail.Body.String())
	}

	rollbackFail := httptest.NewRecorder()
	handler.ServeHTTP(rollbackFail, httptest.NewRequest(http.MethodPost, "/api/logs/missing-op-id/rollback", nil))
	if rollbackFail.Code != http.StatusInternalServerError {
		t.Fatalf("rollback store error should be 500, got %d body=%s", rollbackFail.Code, rollbackFail.Body.String())
	}

	var payload map[string]string
	if err := json.Unmarshal(getFail.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode store error: %v", err)
	}
	if payload["error"] == app.ErrNotFound.Error() {
		t.Fatalf("store error must not be serialized as not found: %+v", payload)
	}
}
