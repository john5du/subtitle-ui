package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/provider/jellyfin"
	"subtitle-ui/backend/internal/store"
)

func TestIssueStreamTicketRequiresJellyfin(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(movieDir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("fake-mp4-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>Stream Test</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatal(err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot:     movieRoot,
		TVMediaRoot:        tvRoot,
		DatabaseURL:        store.TestDSN(t),
		AdminToken:         "test-admin-token",
		StreamTicketSecret: "stream-secret",
		StreamTicketTTL:    time.Minute,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = svc.Close() }()

	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := mustListVideosPage(t, svc, "movie", 10)
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	videoID := page.Items[0].ID

	_, err = svc.IssueStreamTicket(context.Background(), videoID)
	if !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("expected provider disabled, got %v", err)
	}
}

func TestIssueAndValidateStreamTicketWithJellyfin(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	videoPath := filepath.Join(movieDir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("fake-mp4-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>Stream Test</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatal(err)
	}

	payload := []byte("0123456789abcdefghij")
	var itemsHits atomic.Int32
	var playbackHits atomic.Int32
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "jf-key" && !strings.Contains(r.Header.Get("Authorization"), "jf-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Items":
			itemsHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{
					{"Id": "item-1", "Path": videoPath},
				},
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/PlaybackInfo"):
			playbackHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"PlaySessionId": "ps-1",
				"MediaSources": []map[string]any{
					{"Id": "ms-1", "SupportsDirectPlay": true, "SupportsDirectStream": true},
				},
			})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/Videos/") && strings.HasSuffix(r.URL.Path, "/stream"):
			if r.Header.Get("Range") == "bytes=0-3" {
				w.Header().Set("Content-Type", "video/mp4")
				w.Header().Set("Content-Range", "bytes 0-3/20")
				w.Header().Set("Accept-Ranges", "bytes")
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(payload[:4])
				return
			}
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer jf.Close()

	svc, err := NewService(config.Config{
		MovieMediaRoot:     movieRoot,
		TVMediaRoot:        tvRoot,
		DatabaseURL:        store.TestDSN(t),
		AdminToken:         "test-admin-token",
		StreamTicketSecret: "stream-secret",
		StreamTicketTTL:    time.Minute,
		JellyfinEnabled:    true,
		JellyfinURL:        jf.URL,
		JellyfinAPIKey:     "jf-key",
		JellyfinUserID:     "user-1",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = svc.Close() }()

	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := mustListVideosPage(t, svc, "movie", 10)
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	videoID := page.Items[0].ID

	issued, err := svc.IssueStreamTicket(context.Background(), videoID)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if issued.Ticket == "" || !strings.Contains(issued.URL, "ticket=") {
		t.Fatalf("unexpected ticket payload: %+v", issued)
	}
	if issued.Kind != jellyfin.PlaybackModeProgressive {
		t.Fatalf("kind=%s", issued.Kind)
	}
	if itemsHits.Load() != 1 {
		t.Fatalf("expected 1 /Items lookup at issue, got %d", itemsHits.Load())
	}
	// probe media source + profiled PlaybackInfo
	if playbackHits.Load() != 2 {
		t.Fatalf("expected PlaybackInfo twice (probe+profile), got %d", playbackHits.Load())
	}

	claims, err := svc.ValidateStreamTicket(videoID, issued.Ticket)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.ItemID != "item-1" || claims.VideoID != videoID || claims.Mode != jellyfin.PlaybackModeProgressive {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if _, err := svc.ValidateStreamTicket(videoID, "v2.bad.h.1.x.dead.beef"); err == nil {
		t.Fatal("expected invalid ticket error")
	}
	if _, err := svc.ValidateStreamTicket("other-id", issued.Ticket); err == nil {
		t.Fatal("expected video id mismatch error")
	}

	for i := 0; i < 3; i++ {
		stream, err := svc.OpenJellyfinUpstream(context.Background(), claims.UpstreamPath, http.MethodGet, "")
		if err != nil {
			t.Fatalf("open stream: %v", err)
		}
		body, err := io.ReadAll(stream.Body)
		_ = stream.Body.Close()
		if err != nil {
			t.Fatalf("read stream: %v", err)
		}
		if string(body) != string(payload) {
			t.Fatalf("stream body %q", body)
		}
	}
	if itemsHits.Load() != 1 {
		t.Fatalf("stream path must not re-query /Items, hits=%d", itemsHits.Load())
	}
}

func TestIssueStreamTicketHLSKind(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie")
	_ = os.MkdirAll(movieDir, 0o755)
	_ = os.MkdirAll(tvRoot, 0o755)
	videoPath := filepath.Join(movieDir, "movie.mp4")
	_ = os.WriteFile(videoPath, []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>M</title><year>2025</year></movie>"), 0o644)

	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "jf-key" && !strings.Contains(r.Header.Get("Authorization"), "jf-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Items":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{{"Id": "item-h", "Path": videoPath}},
			})
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "PlaybackInfo"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"PlaySessionId": "ps-h",
				"MediaSources": []map[string]any{
					{
						"Id":             "ms-h",
						"TranscodingUrl": "/Videos/item-h/master.m3u8?MediaSourceId=ms-h&api_key=secret",
					},
				},
			})
		case r.URL.Path == "/Videos/item-h/master.m3u8":
			_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:6,\nseg0.ts\n"))
		case r.URL.Path == "/Videos/item-h/seg0.ts":
			w.Header().Set("Content-Type", "video/mp2t")
			_, _ = w.Write([]byte{0x47, 0x40, 0x00, 0x10, 0x00})
		default:
			http.NotFound(w, r)
		}
	}))
	defer jf.Close()

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot, TVMediaRoot: tvRoot,
		DatabaseURL: store.TestDSN(t), AdminToken: "tok",
		StreamTicketSecret: "sec", StreamTicketTTL: time.Minute,
		JellyfinEnabled: true, JellyfinURL: jf.URL, JellyfinAPIKey: "jf-key",
		JellyfinUserID: "user-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatal(status.Error)
	}
	videoID := mustListVideosPage(t, svc, "movie", 10).Items[0].ID
	issued, err := svc.IssueStreamTicket(context.Background(), videoID)
	if err != nil {
		t.Fatal(err)
	}
	if issued.Kind != jellyfin.PlaybackModeHLS {
		t.Fatalf("kind=%s", issued.Kind)
	}
	if !strings.Contains(issued.URL, "/hls/master?") {
		t.Fatalf("url=%s", issued.URL)
	}
	claims, err := svc.ValidateStreamTicket(videoID, issued.Ticket)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(claims.UpstreamPath, "api_key") {
		t.Fatalf("api_key must be stripped: %s", claims.UpstreamPath)
	}
	rewritten := svc.RewriteHLSPlaylist("#EXTM3U\nseg0.mp4\n", videoID, issued.Ticket, claims.UpstreamPath)
	if !strings.Contains(rewritten, "/hls/seg?ticket=") || !strings.Contains(rewritten, "u=") {
		t.Fatalf("rewrite: %s", rewritten)
	}
}

func TestStreamTicketExpired(t *testing.T) {
	svc := &Service{cfg: config.Config{AdminToken: "tok", StreamTicketSecret: "sec"}}
	exp := time.Now().UTC().Add(-time.Minute).Unix()
	ticket, err := svc.signStreamTicket("vid", "item1", streamModeProgressive, exp, "nonce", "/Videos/item1/stream?static=true")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ValidateStreamTicket("vid", ticket); !errors.Is(err, ErrStreamTicketExpired) {
		t.Fatalf("expected expired, got %v", err)
	}
}

func TestStreamTicketFieldsWithDots(t *testing.T) {
	svc := &Service{cfg: config.Config{AdminToken: "tok", StreamTicketSecret: "sec"}}
	exp := time.Now().UTC().Add(time.Minute).Unix()
	videoID := "vid.with.dots"
	itemID := "item.with.dots"
	ticket, err := svc.signStreamTicket(videoID, itemID, streamModeHLS, exp, "nonce", "/Videos/item.with.dots/master.m3u8")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := svc.ValidateStreamTicket(videoID, ticket)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.VideoID != videoID || claims.ItemID != itemID || claims.Mode != jellyfin.PlaybackModeHLS {
		t.Fatalf("claims=%+v", claims)
	}
}

func TestIssueStreamTicketMapsJellyfinErrors(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie")
	_ = os.MkdirAll(movieDir, 0o755)
	_ = os.MkdirAll(tvRoot, 0o755)
	videoPath := filepath.Join(movieDir, "movie.mp4")
	_ = os.WriteFile(videoPath, []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>M</title><year>2025</year></movie>"), 0o644)

	failJF := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/Items" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{{"Id": "i", "Path": videoPath}},
			})
			return
		}
		http.Error(w, "upstream down", http.StatusInternalServerError)
	}))
	t.Cleanup(failJF.Close)

	svcFail, err := NewService(config.Config{
		MovieMediaRoot: movieRoot, TVMediaRoot: tvRoot,
		DatabaseURL: store.TestDSN(t), AdminToken: "tok",
		StreamTicketSecret: "sec", JellyfinEnabled: true, JellyfinURL: failJF.URL, JellyfinAPIKey: "k",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svcFail.Close() })
	if status := svcFail.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatal(status.Error)
	}
	videoID := mustListVideosPage(t, svcFail, "movie", 10).Items[0].ID
	_, err = svcFail.IssueStreamTicket(context.Background(), videoID)
	if err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("jellyfin 5xx must not be ErrNotFound, got %v", err)
	}

	emptyJF := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "k" && !strings.Contains(r.Header.Get("Authorization"), "k") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{}})
	}))
	t.Cleanup(emptyJF.Close)

	svcEmpty, err := NewService(config.Config{
		MovieMediaRoot: movieRoot, TVMediaRoot: tvRoot,
		DatabaseURL: store.TestDSN(t), AdminToken: "tok",
		StreamTicketSecret: "sec", JellyfinEnabled: true, JellyfinURL: emptyJF.URL, JellyfinAPIKey: "k",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svcEmpty.Close() })
	if status := svcEmpty.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatal(status.Error)
	}
	videoID = mustListVideosPage(t, svcEmpty, "movie", 10).Items[0].ID
	_, err = svcEmpty.IssueStreamTicket(context.Background(), videoID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item should be ErrNotFound, got %v", err)
	}
}

func TestIssueStreamTicketRetriesStaleCachedItemID(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie")
	_ = os.MkdirAll(movieDir, 0o755)
	_ = os.MkdirAll(tvRoot, 0o755)
	videoPath := filepath.Join(movieDir, "movie.mp4")
	_ = os.WriteFile(videoPath, []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>M</title><year>2025</year></movie>"), 0o644)

	var itemsHits atomic.Int32
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "jf-key" && !strings.Contains(r.Header.Get("Authorization"), "jf-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Items":
			n := itemsHits.Add(1)
			id := "old-id"
			if n > 1 {
				id = "new-id"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{{"Id": id, "Path": videoPath}},
			})
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/Items/old-id/PlaybackInfo"):
			http.NotFound(w, r)
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/Items/new-id/PlaybackInfo"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"PlaySessionId": "ps-1",
				"MediaSources": []map[string]any{
					{"Id": "ms-1", "SupportsDirectPlay": true, "SupportsDirectStream": true},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(jf.Close)

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot, TVMediaRoot: tvRoot,
		DatabaseURL: store.TestDSN(t), AdminToken: "tok",
		StreamTicketSecret: "sec", StreamTicketTTL: time.Minute,
		JellyfinEnabled: true, JellyfinURL: jf.URL, JellyfinAPIKey: "jf-key",
		JellyfinUserID: "user-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatal(status.Error)
	}
	videoID := mustListVideosPage(t, svc, "movie", 10).Items[0].ID
	issued, err := svc.IssueStreamTicket(context.Background(), videoID)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	claims, err := svc.ValidateStreamTicket(videoID, issued.Ticket)
	if err != nil {
		t.Fatal(err)
	}
	if claims.ItemID != "new-id" {
		t.Fatalf("itemID=%q", claims.ItemID)
	}
	if itemsHits.Load() != 2 {
		t.Fatalf("expected one re-scan after stale 404, hits=%d", itemsHits.Load())
	}
}
