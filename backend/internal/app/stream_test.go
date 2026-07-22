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
		DBPath:             filepath.Join(base, "test.sqlite3"),
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
	page := svc.ListVideosPage("", "movie", "", 1, 10, "", "")
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
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/Videos/") && strings.HasSuffix(r.URL.Path, "/stream"):
			if !strings.Contains(r.URL.Path, "/Videos/item-1/") {
				http.NotFound(w, r)
				return
			}
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
		DBPath:             filepath.Join(base, "test.sqlite3"),
		AdminToken:         "test-admin-token",
		StreamTicketSecret: "stream-secret",
		StreamTicketTTL:    time.Minute,
		JellyfinEnabled:    true,
		JellyfinURL:        jf.URL,
		JellyfinAPIKey:     "jf-key",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = svc.Close() }()

	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", "movie", "", 1, 10, "", "")
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
	if itemsHits.Load() != 1 {
		t.Fatalf("expected 1 /Items lookup at issue, got %d", itemsHits.Load())
	}

	claims, err := svc.ValidateStreamTicket(videoID, issued.Ticket)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.ItemID != "item-1" || claims.VideoID != videoID {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if _, err := svc.ValidateStreamTicket(videoID, "v1.bad.item.1.x.dead"); err == nil {
		t.Fatal("expected invalid ticket error")
	}
	if _, err := svc.ValidateStreamTicket("other-id", issued.Ticket); err == nil {
		t.Fatal("expected video id mismatch error")
	}

	// Stream must use embedded item id — no further /Items lookups on Range-like opens.
	for i := 0; i < 3; i++ {
		stream, err := svc.OpenJellyfinVideoStream(context.Background(), claims.ItemID, http.MethodGet, "")
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
	if c := svc.jellyfinClient(); c == nil || !c.Enabled() {
		t.Fatal("expected jellyfin client enabled")
	}
}

func TestStreamTicketExpired(t *testing.T) {
	svc := &Service{cfg: config.Config{AdminToken: "tok", StreamTicketSecret: "sec"}}
	exp := time.Now().UTC().Add(-time.Minute).Unix()
	ticket, err := svc.signStreamTicket("vid", "item1", exp, "nonce")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ValidateStreamTicket("vid", ticket); !errors.Is(err, ErrStreamTicketExpired) {
		t.Fatalf("expected expired, got %v", err)
	}
}

func TestIssueStreamTicketMapsJellyfinErrors(t *testing.T) {
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
	if err := os.WriteFile(videoPath, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>M</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Upstream 500 → not ErrNotFound
	failJF := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream down", http.StatusInternalServerError)
	}))
	t.Cleanup(failJF.Close)

	svcFail, err := NewService(config.Config{
		MovieMediaRoot: movieRoot, TVMediaRoot: tvRoot,
		DBPath: filepath.Join(base, "fail.sqlite3"), AdminToken: "tok",
		StreamTicketSecret: "sec", JellyfinEnabled: true, JellyfinURL: failJF.URL, JellyfinAPIKey: "k",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svcFail.Close() })
	if status := svcFail.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatal(status.Error)
	}
	videoID := svcFail.ListVideosPage("", "movie", "", 1, 10, "", "").Items[0].ID
	_, err = svcFail.IssueStreamTicket(context.Background(), videoID)
	if err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("jellyfin 5xx must not be ErrNotFound, got %v", err)
	}

	// Empty library → ErrNotFound
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
		DBPath: filepath.Join(base, "empty.sqlite3"), AdminToken: "tok",
		StreamTicketSecret: "sec", JellyfinEnabled: true, JellyfinURL: emptyJF.URL, JellyfinAPIKey: "k",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svcEmpty.Close() })
	if status := svcEmpty.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatal(status.Error)
	}
	videoID = svcEmpty.ListVideosPage("", "movie", "", 1, 10, "", "").Items[0].ID
	_, err = svcEmpty.IssueStreamTicket(context.Background(), videoID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing item should be ErrNotFound, got %v", err)
	}
}
