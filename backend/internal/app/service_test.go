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

func TestDirectoryScanResultIncludesIndexedMovieAndSeriesCounts(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	movieA := filepath.Join(movieRoot, "Movie A")
	movieB := filepath.Join(movieRoot, "Movie B")
	if err := os.MkdirAll(movieA, 0o755); err != nil {
		t.Fatalf("mkdir movie A: %v", err)
	}
	if err := os.MkdirAll(movieB, 0o755); err != nil {
		t.Fatalf("mkdir movie B: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieA, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie A: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieA, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2024")), 0o644); err != nil {
		t.Fatalf("write movie A nfo: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieB, "movie-b.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie B: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieB, "movie-b.nfo"), []byte(sampleNFO("Movie B", "2025")), 0o644); err != nil {
		t.Fatalf("write movie B nfo: %v", err)
	}

	seriesAEpisode := filepath.Join(tvRoot, "Series A", "Season 1", "series-a-s01e01.mkv")
	seriesBEpisode := filepath.Join(tvRoot, "Series B", "Season 1", "series-b-s01e01.mkv")
	if err := os.MkdirAll(filepath.Dir(seriesAEpisode), 0o755); err != nil {
		t.Fatalf("mkdir series A: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(seriesBEpisode), 0o755); err != nil {
		t.Fatalf("mkdir series B: %v", err)
	}
	if err := os.WriteFile(seriesAEpisode, []byte("video"), 0o644); err != nil {
		t.Fatalf("write series A episode: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(seriesAEpisode), "series-a-s01e01.nfo"), []byte(sampleNFO("Series A", "2024")), 0o644); err != nil {
		t.Fatalf("write series A nfo: %v", err)
	}
	if err := os.WriteFile(seriesBEpisode, []byte("video"), 0o644); err != nil {
		t.Fatalf("write series B episode: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(seriesBEpisode), "series-b-s01e01.nfo"), []byte(sampleNFO("Series B", "2025")), 0o644); err != nil {
		t.Fatalf("write series B nfo: %v", err)
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

	last := svc.LastDirectoryScan()
	if last.MovieCount != 2 {
		t.Fatalf("expected LastDirectoryScan movieCount=2, got %d", last.MovieCount)
	}
	if last.TVSeriesCount != 2 {
		t.Fatalf("expected LastDirectoryScan tvSeriesCount=2, got %d", last.TVSeriesCount)
	}

	discovered := svc.DiscoverDirectories(context.Background())
	if discovered.MovieCount != 2 {
		t.Fatalf("expected DiscoverDirectories movieCount=2, got %d", discovered.MovieCount)
	}
	if discovered.TVSeriesCount != 2 {
		t.Fatalf("expected DiscoverDirectories tvSeriesCount=2, got %d", discovered.TVSeriesCount)
	}
}

func TestReadSubtitleContentReturnsStoredFileBytes(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}

	expected := "1\n00:00:01,000 --> 00:00:03,000\nhello preview\n"
	subPath := filepath.Join(movieDir, "movie-a.zh.srt")
	if err := os.WriteFile(subPath, []byte(expected), 0o644); err != nil {
		t.Fatalf("write subtitle: %v", err)
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

	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 {
		t.Fatalf("expected one movie, got %d", len(page.Items))
	}
	if len(page.Items[0].Subtitles) != 1 {
		t.Fatalf("expected one subtitle, got %d", len(page.Items[0].Subtitles))
	}

	video := page.Items[0]
	sub := video.Subtitles[0]
	content, err := svc.ReadSubtitleContent(video.ID, sub.ID)
	if err != nil {
		t.Fatalf("read subtitle content: %v", err)
	}
	if string(content) != expected {
		t.Fatalf("unexpected subtitle content: %q", string(content))
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
