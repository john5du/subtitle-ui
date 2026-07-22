package jellyfin_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

func TestReportMediaUpdatedAndFallbackRefresh(t *testing.T) {
	var mediaUpdated atomic.Int32
	var refresh atomic.Int32
	var items atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Emby-Token")
		if token != "test-key" {
			// also accept Authorization
			if !strings.Contains(r.Header.Get("Authorization"), "test-key") {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/Library/Media/Updated":
			mediaUpdated.Add(1)
			body, _ := io.ReadAll(r.Body)
			var payload struct {
				Updates []struct {
					Path       string `json:"Path"`
					UpdateType string `json:"UpdateType"`
				} `json:"Updates"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Errorf("decode body: %v", err)
			}
			if len(payload.Updates) != 1 || payload.Updates[0].Path != "/data/movies/Foo.mkv" {
				t.Errorf("unexpected payload: %s", body)
			}
			if payload.Updates[0].UpdateType != "Modified" {
				t.Errorf("update type: %s", payload.Updates[0].UpdateType)
			}
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/Items":
			items.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{
					{"Id": "item-1", "Path": "/data/movies/Foo.mkv"},
				},
			})
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/Items/") && strings.HasSuffix(r.URL.Path, "/Refresh"):
			refresh.Add(1)
			if r.URL.Query().Get("metadataRefreshMode") != "ValidationOnly" {
				t.Errorf("metadataRefreshMode=%q", r.URL.Query().Get("metadataRefreshMode"))
			}
			if r.URL.Query().Get("imageRefreshMode") != "None" {
				t.Errorf("imageRefreshMode=%q", r.URL.Query().Get("imageRefreshMode"))
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true,
		BaseURL: srv.URL,
		APIKey:  "test-key",
		PathMaps: []jellyfin.PathMap{
			{From: "/host/movies", To: "/data/movies"},
		},
		HTTPClient: srv.Client(),
	})

	if err := c.NotifyVideoChanged(context.Background(), "/host/movies/Foo.mkv"); err != nil {
		t.Fatalf("notify: %v", err)
	}
	if mediaUpdated.Load() != 1 {
		t.Fatalf("media updated count=%d", mediaUpdated.Load())
	}
	if refresh.Load() != 0 {
		t.Fatalf("refresh should not run when media updated succeeds")
	}

	// Force media updated failure then refresh path.
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/Library/Media/Updated":
			http.Error(w, "fail", http.StatusInternalServerError)
		case r.Method == http.MethodGet && r.URL.Path == "/Items":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{
					{"Id": "item-9", "Path": "/data/movies/Bar.mkv"},
				},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/Items/item-9/Refresh":
			refresh.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(failSrv.Close)

	c2 := jellyfin.New(jellyfin.Options{
		Enabled: true,
		BaseURL: failSrv.URL,
		APIKey:  "test-key",
		PathMaps: []jellyfin.PathMap{
			{From: "/host/movies", To: "/data/movies"},
		},
		HTTPClient: failSrv.Client(),
	})
	if err := c2.NotifyVideoChanged(context.Background(), "/host/movies/Bar.mkv"); err != nil {
		t.Fatalf("notify fallback: %v", err)
	}
	if refresh.Load() != 1 {
		t.Fatalf("expected refresh fallback, got %d", refresh.Load())
	}
}

func TestDisabledNotify(t *testing.T) {
	c := jellyfin.New(jellyfin.Options{Enabled: false})
	err := c.NotifyVideoChanged(context.Background(), "/x")
	if err != jellyfin.ErrDisabled {
		t.Fatalf("got %v", err)
	}
}
