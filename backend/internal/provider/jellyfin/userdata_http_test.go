package jellyfin_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

func TestPlaybackByPathPlayedAndResumable(t *testing.T) {
	var playedCalls, resumableCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/Users" {
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Name": "admin", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/Users/user-1/Items" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("IncludeItemTypes") != "Movie,Episode" {
			t.Errorf("IncludeItemTypes=%q", r.URL.Query().Get("IncludeItemTypes"))
		}
		if !strings.Contains(r.URL.Query().Get("Fields"), "Path") {
			t.Errorf("Fields=%q", r.URL.Query().Get("Fields"))
		}
		switch r.URL.Query().Get("Filters") {
		case "IsPlayed":
			playedCalls.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]any{
					{"Id": "p1", "Path": "/data/movies/Done.mkv", "UserData": map[string]any{"Played": true}},
				},
			})
		case "IsResumable":
			resumableCalls.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]any{
					{"Id": "r1", "Path": "/data/movies/Watching.mkv", "UserData": map[string]any{"PlaybackPositionTicks": 50}},
					{"Id": "p1", "Path": "/data/movies/Done.mkv", "UserData": map[string]any{"Played": true, "PlaybackPositionTicks": 1}},
				},
			})
		default:
			t.Errorf("unexpected Filters=%q", r.URL.Query().Get("Filters"))
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", HTTPClient: srv.Client(),
	})
	m, err := c.PlaybackByPath(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if playedCalls.Load() != 1 || resumableCalls.Load() != 1 {
		t.Fatalf("calls played=%d resumable=%d", playedCalls.Load(), resumableCalls.Load())
	}
	done, ok := c.LookupPlayback("/data/movies/Done.mkv", m)
	if !ok || !done.Played || done.InProgress {
		t.Fatalf("done: ok=%v %+v", ok, done)
	}
	watch, ok := c.LookupPlayback("/data/movies/Watching.mkv", m)
	if !ok || watch.Played || !watch.InProgress || watch.PositionTicks != 50 {
		t.Fatalf("watching: ok=%v %+v", ok, watch)
	}

	// Cache: second call must not hit Jellyfin again.
	if _, err := c.PlaybackByPath(context.Background()); err != nil {
		t.Fatal(err)
	}
	if playedCalls.Load() != 1 || resumableCalls.Load() != 1 {
		t.Fatalf("cache miss: played=%d resumable=%d", playedCalls.Load(), resumableCalls.Load())
	}
}

func TestPlaybackByPathPagination(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/Users" {
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
			return
		}
		if r.URL.Path != "/Users/user-1/Items" {
			http.NotFound(w, r)
			return
		}
		start, _ := strconv.Atoi(r.URL.Query().Get("StartIndex"))
		filter := r.URL.Query().Get("Filters")
		if filter == "IsResumable" {
			_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{}})
			return
		}
		items := make([]map[string]any, 0, 100)
		if start == 0 {
			for i := 0; i < 100; i++ {
				items = append(items, map[string]any{
					"Id":   "p" + strconv.Itoa(i),
					"Path": "/data/movies/m" + strconv.Itoa(i) + ".mkv",
				})
			}
		} else if start == 100 {
			items = append(items, map[string]any{"Id": "p100", "Path": "/data/movies/m100.mkv"})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"Items": items})
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", HTTPClient: srv.Client(),
	})
	m, err := c.PlaybackByPath(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 101 {
		t.Fatalf("len=%d", len(m))
	}
	if _, ok := c.LookupPlayback("/data/movies/m100.mkv", m); !ok {
		t.Fatal("missing page-2 item")
	}
}

func TestPlaybackByPathSingleFlight(t *testing.T) {
	var inflight atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/Users" {
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
			return
		}
		if r.URL.Path != "/Users/user-1/Items" {
			http.NotFound(w, r)
			return
		}
		n := inflight.Add(1)
		if n == 1 {
			close(started)
		}
		<-release
		_ = json.NewEncoder(w).Encode(map[string]any{
			"Items": []map[string]any{{"Path": "/data/movies/A.mkv"}},
		})
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", HTTPClient: srv.Client(),
	})
	errCh := make(chan error, 2)
	go func() {
		_, err := c.PlaybackByPath(context.Background())
		errCh <- err
	}()
	go func() {
		_, err := c.PlaybackByPath(context.Background())
		errCh <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not start")
	}
	time.Sleep(30 * time.Millisecond)
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-errCh; err != nil {
			t.Fatal(err)
		}
	}
	if inflight.Load() != 2 {
		t.Fatalf("expected 2 filter requests (IsPlayed+IsResumable), got %d", inflight.Load())
	}
}

func TestPlaybackByPathDisabled(t *testing.T) {
	c := jellyfin.New(jellyfin.Options{Enabled: false})
	_, err := c.PlaybackByPath(context.Background())
	if !errors.Is(err, jellyfin.ErrDisabled) {
		t.Fatalf("got %v", err)
	}
}

func TestPlaybackByPathConfiguredUserID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/Users" {
			t.Error("configured UserID must not list /Users")
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/Users/fixed-user/Items" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{}})
	}))
	t.Cleanup(srv.Close)
	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", UserID: "fixed-user", HTTPClient: srv.Client(),
	})
	if _, err := c.PlaybackByPath(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPlaybackByPathTimeout(t *testing.T) {
	var items atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/Users" {
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
			return
		}
		if r.URL.Path != "/Users/user-1/Items" {
			http.NotFound(w, r)
			return
		}
		items.Add(1)
		time.Sleep(80 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"Items": []map[string]any{{"Path": "/data/movies/A.mkv"}},
		})
	}))
	t.Cleanup(srv.Close)
	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", HTTPClient: srv.Client(),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
	defer cancel()
	if _, err := c.PlaybackByPath(ctx); err == nil {
		t.Fatal("expected caller timeout")
	}
	deadline := time.Now().Add(2 * time.Second)
	var m map[string]jellyfin.ItemPlayback
	for {
		got, err := c.PlaybackByPath(context.Background())
		if err == nil {
			m = got
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("fetch did not complete: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, ok := c.LookupPlayback("/data/movies/A.mkv", m); !ok {
		t.Fatal("cancelled caller should not drop in-flight fetch")
	}
	n := items.Load()
	if _, err := c.PlaybackByPath(context.Background()); err != nil {
		t.Fatal(err)
	}
	if items.Load() != n {
		t.Fatalf("cached fetch re-hit jellyfin: before=%d after=%d", n, items.Load())
	}
}

func TestPlaybackByPathErrorNegativeCache(t *testing.T) {
	var items atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/Users" {
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
			return
		}
		if r.URL.Path != "/Users/user-1/Items" {
			http.NotFound(w, r)
			return
		}
		items.Add(1)
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", HTTPClient: srv.Client(),
	})
	if _, err := c.PlaybackByPath(context.Background()); err == nil {
		t.Fatal("expected error")
	}
	first := items.Load()
	if first == 0 {
		t.Fatal("expected jellyfin items call")
	}
	if _, err := c.PlaybackByPath(context.Background()); err == nil {
		t.Fatal("expected cached error")
	}
	if items.Load() != first {
		t.Fatalf("negative cache miss: first=%d after=%d", first, items.Load())
	}
}
