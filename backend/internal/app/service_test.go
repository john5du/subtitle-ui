package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
)

func TestRunFileScanWritesScanLogWithChangeSummary(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	videoPath := filepath.Join(movieDir, "movie-a.mkv")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	nfoPath := filepath.Join(movieDir, "movie-a.nfo")
	if err := os.WriteFile(nfoPath, []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	status := svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("scan status error: %s", status.Error)
	}

	firstScanLog, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatalf("expected scan operation log")
	}
	if firstScanLog.Status != "ok" {
		t.Fatalf("expected scan log status ok, got %s", firstScanLog.Status)
	}
	if !strings.Contains(firstScanLog.Message, "added=1") {
		t.Fatalf("expected added count in log message, got %q", firstScanLog.Message)
	}

	if err := os.WriteFile(nfoPath, []byte(sampleNFO("Movie A Updated", "2025")), 0o644); err != nil {
		t.Fatalf("rewrite nfo: %v", err)
	}

	status = svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("second scan status error: %s", status.Error)
	}

	secondScanLog, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatalf("expected second scan operation log")
	}
	if !strings.Contains(secondScanLog.Message, "updated=1") {
		t.Fatalf("expected updated count in log message, got %q", secondScanLog.Message)
	}
}

func TestCheckMediaRootWritePermissionsWritesErrorLog(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "missing-movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	issues := svc.CheckMediaRootWritePermissions()
	if len(issues) != 1 {
		t.Fatalf("expected exactly 1 permission issue, got %d (%v)", len(issues), issues)
	}
	if !strings.Contains(issues[0], movieRoot) {
		t.Fatalf("expected issue to include movie root, got %q", issues[0])
	}

	logEntry, ok := latestLogByAction(svc.ListLogs(10), "permission_check")
	if !ok {
		t.Fatalf("expected permission_check log entry")
	}
	if logEntry.Status != "error" {
		t.Fatalf("expected permission_check status error, got %s", logEntry.Status)
	}
	if logEntry.VideoID != systemOperationVideoID {
		t.Fatalf("expected video id %q, got %q", systemOperationVideoID, logEntry.VideoID)
	}
	if !strings.Contains(logEntry.TargetPath, movieRoot) {
		t.Fatalf("expected target path to include movie root, got %q", logEntry.TargetPath)
	}
}

func latestLogByAction(logs []domain.OperationLog, action string) (domain.OperationLog, bool) {
	for _, item := range logs {
		if item.Action == action {
			return item, true
		}
	}
	return domain.OperationLog{}, false
}

func sampleNFO(title string, year string) string {
	return "<movie><title>" + title + "</title><year>" + year + "</year></movie>"
}
