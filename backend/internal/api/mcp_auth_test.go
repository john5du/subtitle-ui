package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func newMCPTestServer(t *testing.T, mcpBootstrap bool) (*Server, *app.Service) {
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
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
		MCPEnabled:     mcpBootstrap,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	_ = svc.RunFileScan(context.Background(), nil, nil)

	server := NewServerWithConfig(svc, config.Config{
		UIDist:     "",
		AdminToken: "secret-token",
	})
	return server, svc
}

func TestMCPRequiresBearer(t *testing.T) {
	server, svc := newMCPTestServer(t, true)
	if !svc.MCPEnabled() {
		t.Fatal("expected mcp enabled from bootstrap")
	}

	req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth status=%d body=%s", rec.Code, rec.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req2.Header.Set("Authorization", "Bearer secret-token")
	rec2 := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec2, req2)
	if rec2.Code == http.StatusUnauthorized {
		t.Fatalf("authorized still unauthorized: %s", rec2.Body.String())
	}
	if rec2.Code == http.StatusServiceUnavailable {
		t.Fatalf("mcp should be enabled: %s", rec2.Body.String())
	}
}

func TestMCPDisabledReturns503(t *testing.T) {
	server, svc := newMCPTestServer(t, false)
	if svc.MCPEnabled() {
		t.Fatal("expected mcp disabled by default")
	}

	req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s want 503", rec.Code, rec.Body.String())
	}
}

func TestMCPConfigGetPut(t *testing.T) {
	server, svc := newMCPTestServer(t, false)

	req := httptest.NewRequest(http.MethodGet, "/api/config/mcp", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status=%d body=%s", rec.Code, rec.Body.String())
	}
	var cfg domain.MCPConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Enabled || cfg.Endpoint != "/mcp" {
		t.Fatalf("unexpected cfg: %+v", cfg)
	}

	body := bytes.NewBufferString(`{"enabled":true}`)
	req2 := httptest.NewRequest(http.MethodPut, "/api/config/mcp", body)
	req2.Header.Set("Authorization", "Bearer secret-token")
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("put status=%d body=%s", rec2.Code, rec2.Body.String())
	}
	if !svc.MCPEnabled() {
		t.Fatal("expected mcp enabled after PUT")
	}

	req3 := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req3.Header.Set("Authorization", "Bearer secret-token")
	rec3 := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec3, req3)
	if rec3.Code == http.StatusServiceUnavailable {
		t.Fatalf("mcp still disabled after enable: %s", rec3.Body.String())
	}
}
