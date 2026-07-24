package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
)

func newMovieServiceFixture(t *testing.T, base string, srtContent string) (*Service, domain.Video) {
	t.Helper()

	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	if srtContent != "" {
		if err := os.WriteFile(filepath.Join(movieDir, "movie-a.zh.srt"), []byte(srtContent), 0o644); err != nil {
			t.Fatalf("write srt: %v", err)
		}
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		_ = svc.Close()
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 {
		_ = svc.Close()
		t.Fatalf("expected one movie, got %d", len(page.Items))
	}
	return svc, page.Items[0]
}

func latestLogByAction(logs []domain.OperationLog, action string) (domain.OperationLog, bool) {
	for _, item := range logs {
		if item.Action == action {
			return item, true
		}
	}
	return domain.OperationLog{}, false
}

func findSubtitleByFileName(subtitles []domain.Subtitle, fileName string) (domain.Subtitle, bool) {
	for _, sub := range subtitles {
		if sub.FileName == fileName {
			return sub, true
		}
	}
	return domain.Subtitle{}, false
}

func sampleNFO(title string, year string) string {
	return "<movie><title>" + title + "</title><year>" + year + "</year></movie>"
}
