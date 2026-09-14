package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func newScanConfigTestServer(t *testing.T) (*Server, *app.Service) {
	t.Helper()
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	svc, err := app.NewService(config.Config{
		MovieMediaRoot:  movieRoot,
		TVMediaRoot:     tvRoot,
		DatabaseURL:     store.TestDSN(t),
		ScanAutoEnabled: true,
		ScanInterval:    time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	server := NewServerWithConfig(svc, config.Config{
		UIDist:     "",
		AdminToken: "secret-token",
	})
	return server, svc
}

func TestScanConfigGetPut(t *testing.T) {
	server, svc := newScanConfigTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/config/scan", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status=%d body=%s", rec.Code, rec.Body.String())
	}
	var cfg domain.ScanConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.Enabled || cfg.Interval != "1h" {
		t.Fatalf("unexpected cfg: %+v", cfg)
	}

	body := bytes.NewBufferString(`{"enabled":false,"interval":"15m"}`)
	req2 := httptest.NewRequest(http.MethodPut, "/api/config/scan", body)
	req2.Header.Set("Authorization", "Bearer secret-token")
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("put status=%d body=%s", rec2.Code, rec2.Body.String())
	}
	got, err := svc.GetScanConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got.Enabled || got.Interval != "15m" {
		t.Fatalf("expected disabled 15m, got %+v", got)
	}

	body3 := bytes.NewBufferString(`{"enabled":true,"interval":"30s"}`)
	req3 := httptest.NewRequest(http.MethodPut, "/api/config/scan", body3)
	req3.Header.Set("Authorization", "Bearer secret-token")
	req3.Header.Set("Content-Type", "application/json")
	rec3 := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("invalid interval status=%d body=%s", rec3.Code, rec3.Body.String())
	}
}
