package app

import (
	"context"
	"errors"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
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

func TestSubtitleConversionConfigDefaultsAndRejectsInvalidTemplate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
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

	cfg, err := svc.GetSubtitleConversionConfig()
	if err != nil {
		t.Fatalf("get default conversion config: %v", err)
	}
	if cfg.ASSTemplate != subtitle.DefaultASSTemplate {
		t.Fatalf("expected default ass template")
	}
	if cfg.SourceEncodingDefault != subtitle.DefaultSourceEncoding {
		t.Fatalf("expected default source encoding, got %q", cfg.SourceEncodingDefault)
	}

	customTemplate := strings.Replace(subtitle.DefaultASSTemplate, "Style: Default,Arial,48", "Style: Default,Verdana,46", 1)
	saved, err := svc.UpdateSubtitleConversionConfig(domain.SubtitleConversionConfigUpdate{
		ASSTemplate:           customTemplate,
		SourceEncodingDefault: "gb18030",
	})
	if err != nil {
		t.Fatalf("save conversion config: %v", err)
	}
	if saved.SourceEncodingDefault != "gb18030" {
		t.Fatalf("expected normalized source encoding, got %q", saved.SourceEncodingDefault)
	}

	_, err = svc.UpdateSubtitleConversionConfig(domain.SubtitleConversionConfigUpdate{
		ASSTemplate:           strings.Replace(customTemplate, subtitle.ASSTemplateDialoguesPlaceholder, "", 1),
		SourceEncodingDefault: "utf-8",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid template, got %v", err)
	}

	after, err := svc.GetSubtitleConversionConfig()
	if err != nil {
		t.Fatalf("get conversion config after invalid update: %v", err)
	}
	if after.ASSTemplate != strings.TrimSpace(customTemplate) || after.SourceEncodingDefault != "gb18030" {
		t.Fatalf("invalid update should not overwrite config")
	}
}

func TestUploadSubtitleWithASSConversionPreservesOriginalSRT(t *testing.T) {
	base := t.TempDir()
	svc, video := newMovieServiceFixture(t, base, "")
	defer func() {
		_ = svc.Close()
	}()

	uploadPath := filepath.Join(base, "upload.zh.srt")
	srtContent := []byte("1\n00:00:01,000 --> 00:00:02,500\nhello upload\n")
	if err := os.WriteFile(uploadPath, srtContent, 0o644); err != nil {
		t.Fatalf("write upload source: %v", err)
	}
	file, err := os.Open(uploadPath)
	if err != nil {
		t.Fatalf("open upload source: %v", err)
	}
	defer file.Close()

	created, err := svc.UploadSubtitleWithOptions(video.ID, file, &multipart.FileHeader{Filename: "upload.zh.srt"}, "zh", "", SubtitleUploadOptions{
		ConvertTo:      "ass",
		SourceEncoding: "utf-8",
	})
	if err != nil {
		t.Fatalf("upload with ass conversion: %v", err)
	}
	if created.Format != "ass" {
		t.Fatalf("expected returned subtitle to be ass, got %s", created.Format)
	}

	srtPath := filepath.Join(video.Directory, "movie-a.zh.srt")
	assPath := filepath.Join(video.Directory, "movie-a.zh.ass")
	if _, err := os.Stat(srtPath); err != nil {
		t.Fatalf("expected original srt to exist: %v", err)
	}
	assBytes, err := os.ReadFile(assPath)
	if err != nil {
		t.Fatalf("expected converted ass to exist: %v", err)
	}
	if !strings.Contains(string(assBytes), "Dialogue: 0,0:00:01.00,0:00:02.50") {
		t.Fatalf("expected converted dialogue, got %q", string(assBytes))
	}

	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 || len(page.Items[0].Subtitles) != 2 {
		t.Fatalf("expected srt and ass subtitles, got page=%+v", page)
	}
}

func TestConvertExistingSRTSubtitleToASS(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:03,000 --> 00:00:04,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected existing subtitle, got %d", len(video.Subtitles))
	}

	created, err := svc.ConvertSubtitleToASS(video.ID, video.Subtitles[0].ID, SubtitleConvertOptions{SourceEncoding: "utf-8"})
	if err != nil {
		t.Fatalf("convert existing srt: %v", err)
	}
	if created.Format != "ass" {
		t.Fatalf("expected ass subtitle, got %s", created.Format)
	}
	if _, err := os.Stat(video.Subtitles[0].Path); err != nil {
		t.Fatalf("expected original srt to remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(video.Directory, "movie-a.zh.ass")); err != nil {
		t.Fatalf("expected converted ass file: %v", err)
	}
}

func TestRunFileScanPersistsPosterPaths(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
		t.Fatalf("write movie nfo: %v", err)
	}
	moviePosterPath := filepath.Join(movieDir, "movie.png")
	if err := os.WriteFile(moviePosterPath, []byte("movie-poster"), 0o644); err != nil {
		t.Fatalf("write movie poster: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a-poster.bmp"), []byte("movie-poster-fallback"), 0o644); err != nil {
		t.Fatalf("write movie poster fallback: %v", err)
	}

	tvEpisodePath := filepath.Join(tvRoot, "Series A", "Season 1", "series-a-s01e01.mkv")
	if err := os.MkdirAll(filepath.Dir(tvEpisodePath), 0o755); err != nil {
		t.Fatalf("mkdir tv dir: %v", err)
	}
	if err := os.WriteFile(tvEpisodePath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write tv episode: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(tvEpisodePath), "series-a-s01e01.nfo"), []byte(sampleNFO("Series A", "2024")), 0o644); err != nil {
		t.Fatalf("write tv nfo: %v", err)
	}
	tvPosterPath := filepath.Join(tvRoot, "Series A", "folder.jpg")
	if err := os.WriteFile(tvPosterPath, []byte("tv-poster"), 0o644); err != nil {
		t.Fatalf("write tv poster: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tvRoot, "Series A", "fanart.png"), []byte("tv-poster-fallback"), 0o644); err != nil {
		t.Fatalf("write tv poster fallback: %v", err)
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

	moviePage := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(moviePage.Items) != 1 {
		t.Fatalf("expected 1 movie, got %d", len(moviePage.Items))
	}
	if moviePage.Items[0].PosterPath != moviePosterPath {
		t.Fatalf("expected movie poster %q, got %q", moviePosterPath, moviePage.Items[0].PosterPath)
	}

	tvPage := svc.ListVideosPage("", domain.MediaTypeTV, "", 1, 20, "", "")
	if len(tvPage.Items) != 1 {
		t.Fatalf("expected 1 tv episode, got %d", len(tvPage.Items))
	}
	if tvPage.Items[0].PosterPath != tvPosterPath {
		t.Fatalf("expected tv poster %q, got %q", tvPosterPath, tvPage.Items[0].PosterPath)
	}
}

func TestRunFileScanMarksPosterChangesAsVideoUpdates(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
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
		t.Fatalf("first scan status error: %s", status.Error)
	}

	if err := os.WriteFile(filepath.Join(movieDir, "cover.jpg"), []byte("poster"), 0o644); err != nil {
		t.Fatalf("write poster: %v", err)
	}

	status = svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("second scan status error: %s", status.Error)
	}

	scanLog, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatalf("expected scan log")
	}
	if !strings.Contains(scanLog.Message, "updated=1") {
		t.Fatalf("expected updated count in log message, got %q", scanLog.Message)
	}
}

func TestResolveVideoPosterPathRejectsUnsafeCandidate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	unsafeDir := filepath.Join(base, "outside")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}
	if err := os.MkdirAll(unsafeDir, 0o755); err != nil {
		t.Fatalf("mkdir unsafe dir: %v", err)
	}

	unsafePosterPath := filepath.Join(unsafeDir, "poster.jpg")
	if err := os.WriteFile(unsafePosterPath, []byte("unsafe"), 0o644); err != nil {
		t.Fatalf("write unsafe poster: %v", err)
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

	now := time.Now().UTC()
	video := domain.Video{
		ID:             "MOVIE-UNSAFE",
		Path:           filepath.Join(movieRoot, "Movie A", "movie-a.mkv"),
		Directory:      filepath.Join(movieRoot, "Movie A"),
		FileName:       "movie-a.mkv",
		Title:          "Movie A",
		Year:           "2025",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		PosterPath:     unsafePosterPath,
		UpdatedAt:      now,
	}
	if err := os.MkdirAll(video.Directory, 0o755); err != nil {
		t.Fatalf("mkdir video dir: %v", err)
	}
	if err := svc.store.SaveScanResult([]domain.Video{video}, now, now, ""); err != nil {
		t.Fatalf("save scan result: %v", err)
	}

	_, err = svc.ResolveVideoPosterPath(video.ID)
	if !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("expected ErrUnsafePath, got %v", err)
	}
}

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

func sampleNFO(title string, year string) string {
	return "<movie><title>" + title + "</title><year>" + year + "</year></movie>"
}
