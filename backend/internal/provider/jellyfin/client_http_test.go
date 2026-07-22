package jellyfin_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

func authOK(r *http.Request, key string) bool {
	if r.Header.Get("X-Emby-Token") == key {
		return true
	}
	return strings.Contains(r.Header.Get("Authorization"), `Token="`+key+`"`)
}

func TestReportMediaUpdatedAndFallbackRefresh(t *testing.T) {
	var mediaUpdated atomic.Int32
	var refresh atomic.Int32
	var items atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
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

func TestPing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.Contains(auth, `Token="test-key"`) && r.Header.Get("X-Emby-Token") != "test-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !strings.Contains(auth, "MediaBrowser") || !strings.Contains(auth, "Client=") {
			http.Error(w, "missing full MediaBrowser auth", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/System/Info" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ServerName": "jf", "Version": "10.9.0"})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled:    true,
		BaseURL:    srv.URL,
		APIKey:     "test-key",
		HTTPClient: srv.Client(),
	})
	if err := c.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestOpenVideoStreamStaticAndRange(t *testing.T) {
	payload := []byte("0123456789abcdefghij")
	var viaCustomTransport atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/Videos/") || !strings.HasSuffix(r.URL.Path, "/stream") {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("static") != "true" {
			http.Error(w, "expected static=true", http.StatusBadRequest)
			return
		}
		if _, ok := r.URL.Query()["Static"]; ok {
			http.Error(w, "unexpected Static query", http.StatusBadRequest)
			return
		}
		switch r.Header.Get("Range") {
		case "bytes=0-3":
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Range", "bytes 0-3/20")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(payload[:4])
			return
		case "bytes=999-1000":
			w.Header().Set("Content-Range", "bytes */20")
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Header().Set("Content-Type", "video/mp4")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
	}))
	t.Cleanup(srv.Close)

	baseTransport := srv.Client().Transport
	if baseTransport == nil {
		baseTransport = http.DefaultTransport
	}
	c := jellyfin.New(jellyfin.Options{
		Enabled: true,
		BaseURL: srv.URL,
		APIKey:  "test-key",
		HTTPClient: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				viaCustomTransport.Store(true)
				return baseTransport.RoundTrip(req)
			}),
		},
	})
	full, err := c.OpenVideoStream(context.Background(), http.MethodGet, "item-1", "")
	if err != nil {
		t.Fatalf("full stream: %v", err)
	}
	defer full.Body.Close()
	if full.StatusCode != http.StatusOK {
		t.Fatalf("status %d", full.StatusCode)
	}
	body, _ := io.ReadAll(full.Body)
	if string(body) != string(payload) {
		t.Fatalf("body %q", body)
	}
	if !viaCustomTransport.Load() {
		t.Fatal("expected OpenVideoStream to use Options.HTTPClient transport")
	}

	partial, err := c.OpenVideoStream(context.Background(), http.MethodGet, "item-1", "bytes=0-3")
	if err != nil {
		t.Fatalf("range stream: %v", err)
	}
	defer partial.Body.Close()
	if partial.StatusCode != http.StatusPartialContent {
		t.Fatalf("status %d", partial.StatusCode)
	}
	body, _ = io.ReadAll(partial.Body)
	if string(body) != string(payload[:4]) {
		t.Fatalf("range body %q", body)
	}

	unsat, err := c.OpenVideoStream(context.Background(), http.MethodGet, "item-1", "bytes=999-1000")
	if err != nil {
		t.Fatalf("416 should pass through, got err %v", err)
	}
	defer unsat.Body.Close()
	if unsat.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status %d", unsat.StatusCode)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFindItemIDByPathPaginatesWithoutSearchTerm(t *testing.T) {
	// Path on disk does not match metadata title ("Pilot"); SearchTerm would miss it.
	targetPath := "/data/tv/Show/Season 01/Show.S01E01.mkv"
	var pages []int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/Items" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("SearchTerm") != "" {
			t.Errorf("SearchTerm must not be used for path lookup, got %q", r.URL.Query().Get("SearchTerm"))
		}
		start, _ := strconv.Atoi(r.URL.Query().Get("StartIndex"))
		limit, _ := strconv.Atoi(r.URL.Query().Get("Limit"))
		if limit != 100 {
			t.Errorf("Limit=%d want 100", limit)
		}
		pages = append(pages, start)
		// Page 0: fillers only; page 100: real path match.
		items := make([]map[string]string, 0, limit)
		if start == 0 {
			for i := 0; i < limit; i++ {
				items = append(items, map[string]string{
					"Id":   fmt.Sprintf("fill-%d", i),
					"Path": fmt.Sprintf("/data/movies/Other%d.mkv", i),
				})
			}
		} else if start == 100 {
			items = append(items, map[string]string{
				"Id":   "ep-pilot",
				"Path": targetPath,
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"Items": items})
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled:    true,
		BaseURL:    srv.URL,
		APIKey:     "test-key",
		HTTPClient: srv.Client(),
	})
	id, err := c.FindItemIDByPath(context.Background(), targetPath)
	if err != nil {
		t.Fatalf("FindItemIDByPath: %v", err)
	}
	if id != "ep-pilot" {
		t.Fatalf("id=%q", id)
	}
	if len(pages) < 2 || pages[0] != 0 || pages[1] != 100 {
		t.Fatalf("expected paginated StartIndex 0 then 100, got %v", pages)
	}
}

func TestFindItemIDByPathNotFoundVsUpstreamError(t *testing.T) {
	notFoundSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{}})
	}))
	t.Cleanup(notFoundSrv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: notFoundSrv.URL, APIKey: "test-key", HTTPClient: notFoundSrv.Client(),
	})
	_, err := c.FindItemIDByPath(context.Background(), "/data/movies/Missing.mkv")
	if !errors.Is(err, jellyfin.ErrItemNotFound) {
		t.Fatalf("expected ErrItemNotFound, got %v", err)
	}

	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(failSrv.Close)
	cFail := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: failSrv.URL, APIKey: "test-key", HTTPClient: failSrv.Client(),
	})
	_, err = cFail.FindItemIDByPath(context.Background(), "/data/movies/X.mkv")
	if err == nil || errors.Is(err, jellyfin.ErrItemNotFound) {
		t.Fatalf("upstream 5xx must not map to ErrItemNotFound, got %v", err)
	}
}

func TestResolvePlaybackPlanDeviceProfileJSON(t *testing.T) {
	// Regression: DeviceProfile.Id is Guid? on Jellyfin; non-GUID Id → ASP.NET 400 "The supplied value is invalid."
	// Also UserId is required for DeviceProfile path (API key has no user claim).
	var profileBodies []map[string]any
	var gotUserQuery string
	var playbackPosts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/Users" {
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-admin", "Name": "admin", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
			return
		}
		if r.Method != http.MethodPost || !strings.Contains(r.URL.Path, "/PlaybackInfo") {
			http.NotFound(w, r)
			return
		}
		playbackPosts++
		gotUserQuery = r.URL.Query().Get("UserId")
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("body: %v", err)
		}
		if body["DeviceProfile"] != nil {
			profileBodies = append(profileBodies, body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"PlaySessionId": "ps",
			"MediaSources": []map[string]any{
				{"Id": "ms-1", "SupportsDirectPlay": true, "SupportsDirectStream": true},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", HTTPClient: srv.Client(),
	})
	plan, err := c.ResolvePlaybackPlan(context.Background(), "item-1")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Mode != jellyfin.PlaybackModeProgressive {
		t.Fatalf("mode=%s", plan.Mode)
	}
	if playbackPosts < 2 {
		t.Fatalf("expected probe+profile PlaybackInfo posts, got %d", playbackPosts)
	}
	if gotUserQuery != "user-admin" {
		t.Fatalf("UserId query=%q", gotUserQuery)
	}
	if len(profileBodies) != 1 {
		t.Fatalf("expected 1 profiled PlaybackInfo body, got %d", len(profileBodies))
	}
	gotBody := profileBodies[0]
	if gotBody["UserId"] != "user-admin" {
		t.Fatalf("UserId body=%v", gotBody["UserId"])
	}
	if gotBody["MediaSourceId"] != "ms-1" {
		t.Fatalf("MediaSourceId=%v", gotBody["MediaSourceId"])
	}
	if v, ok := gotBody["SubtitleStreamIndex"].(float64); !ok || v != -1 {
		t.Fatalf("SubtitleStreamIndex=%v want -1", gotBody["SubtitleStreamIndex"])
	}
	dp, _ := gotBody["DeviceProfile"].(map[string]any)
	if dp == nil {
		t.Fatalf("missing DeviceProfile: %#v", gotBody)
	}
	if id, ok := dp["Id"]; ok && id != nil {
		t.Fatalf("DeviceProfile.Id must be omitted or null (Guid?), got %#v", id)
	}
	tps, _ := dp["TranscodingProfiles"].([]any)
	if len(tps) == 0 {
		t.Fatal("expected TranscodingProfiles")
	}
	tp, _ := tps[0].(map[string]any)
	if tp["Protocol"] != "hls" {
		t.Fatalf("protocol=%v", tp["Protocol"])
	}
}

func TestResolvePlaybackPlanConfiguredUserID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r, "test-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/Users" {
			t.Error("configured UserID must not list /Users")
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/PlaybackInfo") {
			if r.URL.Query().Get("UserId") != "fixed-user" {
				t.Errorf("UserId=%q", r.URL.Query().Get("UserId"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"PlaySessionId": "ps",
				"MediaSources":  []map[string]any{{"Id": "ms", "SupportsDirectPlay": true}},
			})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "test-key", UserID: "fixed-user", HTTPClient: srv.Client(),
	})
	if _, err := c.ResolvePlaybackPlan(context.Background(), "item-1"); err != nil {
		t.Fatal(err)
	}
}

func TestValidatePathMaps(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "test-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Library/PhysicalPaths":
			_ = json.NewEncoder(w).Encode([]string{"/data/movies", "/data/tv"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	okClient := jellyfin.New(jellyfin.Options{
		Enabled: true,
		BaseURL: srv.URL,
		APIKey:  "test-key",
		PathMaps: []jellyfin.PathMap{
			{From: "/host/movies", To: "/data/movies"},
			{From: "/host/tv", To: "/data/tv"},
		},
		HTTPClient: srv.Client(),
	})
	if err := okClient.ValidatePathMaps(context.Background()); err != nil {
		t.Fatalf("expected path maps ok: %v", err)
	}

	badClient := jellyfin.New(jellyfin.Options{
		Enabled: true,
		BaseURL: srv.URL,
		APIKey:  "test-key",
		PathMaps: []jellyfin.PathMap{
			{From: "/host/movies", To: "/wrong/movies"},
		},
		HTTPClient: srv.Client(),
	})
	if err := badClient.ValidatePathMaps(context.Background()); err == nil {
		t.Fatalf("expected path map mismatch")
	}

	emptyClient := jellyfin.New(jellyfin.Options{
		Enabled:    true,
		BaseURL:    srv.URL,
		APIKey:     "test-key",
		HTTPClient: srv.Client(),
	})
	if err := emptyClient.ValidatePathMaps(context.Background()); err != nil {
		t.Fatalf("empty maps should skip: %v", err)
	}
}
