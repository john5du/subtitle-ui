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
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "jf-key" && !strings.Contains(r.Header.Get("Authorization"), "jf-key") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Items":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{
					{"Id": "item-1", "Path": videoPath},
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
	if err := svc.ValidateStreamTicket(videoID, issued.Ticket); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if err := svc.ValidateStreamTicket(videoID, "v1.bad.1.x.dead"); err == nil {
		t.Fatal("expected invalid ticket error")
	}
	if err := svc.ValidateStreamTicket("other-id", issued.Ticket); err == nil {
		t.Fatal("expected video id mismatch error")
	}

	stream, err := svc.OpenJellyfinVideoStream(context.Background(), videoID, http.MethodGet, "")
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer stream.Body.Close()
	body, err := io.ReadAll(stream.Body)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	if string(body) != string(payload) {
		t.Fatalf("stream body %q", body)
	}
	if c := svc.jellyfinClient(); c == nil || !c.Enabled() {
		t.Fatal("expected jellyfin client enabled")
	}
}

func TestStreamTicketExpired(t *testing.T) {
	svc := &Service{cfg: config.Config{AdminToken: "tok", StreamTicketSecret: "sec"}}
	exp := time.Now().UTC().Add(-time.Minute).Unix()
	ticket, err := svc.signStreamTicket("vid", exp, "nonce")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ValidateStreamTicket("vid", ticket); !errors.Is(err, ErrStreamTicketExpired) {
		t.Fatalf("expected expired, got %v", err)
	}
}
