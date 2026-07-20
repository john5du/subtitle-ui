package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"subtitle-ui/backend/internal/config"
)

func TestIssueAndValidateStreamTicket(t *testing.T) {
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
		StreamRemux:        "off",
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

	issued, err := svc.IssueStreamTicket(videoID)
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

	src, err := svc.ResolveVideoStreamSource(videoID, "direct")
	if err != nil {
		t.Fatalf("resolve source: %v", err)
	}
	if src.Remux || src.ContentType != "video/mp4" {
		t.Fatalf("unexpected source: %+v", src)
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

func TestRemuxSlotLimitsConcurrency(t *testing.T) {
	svc := &Service{remuxSem: make(chan struct{}, 2)}
	if !svc.TryAcquireRemuxSlot() || !svc.TryAcquireRemuxSlot() {
		t.Fatal("expected first two acquires to succeed")
	}
	if svc.TryAcquireRemuxSlot() {
		t.Fatal("expected third acquire to fail")
	}
	svc.ReleaseRemuxSlot()
	if !svc.TryAcquireRemuxSlot() {
		t.Fatal("expected acquire after release to succeed")
	}
	svc.ReleaseRemuxSlot()
	svc.ReleaseRemuxSlot()
}
