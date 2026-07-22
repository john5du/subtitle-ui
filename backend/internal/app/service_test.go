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

func TestTVSeriesSummariesUseSeriesNFOForSearchAndExternalIDs(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}

	episodeDir := filepath.Join(tvRoot, "Daredevil - Born Again", "Season 1")
	if err := os.MkdirAll(episodeDir, 0o755); err != nil {
		t.Fatalf("mkdir episode dir: %v", err)
	}
	episodePath := filepath.Join(episodeDir, "Afterlight Station S01E01.mkv")
	if err := os.WriteFile(episodePath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write episode: %v", err)
	}
	episodeNFO := `<episodedetails><title>Platform Zero</title><originaltitle>Platform Zero Original</originaltitle><year>2025</year></episodedetails>`
	if err := os.WriteFile(filepath.Join(episodeDir, "Afterlight Station S01E01.nfo"), []byte(episodeNFO), 0o644); err != nil {
		t.Fatalf("write episode nfo: %v", err)
	}
	seriesNFO := `<tvshow><title>夜魔侠：重生</title><originaltitle>Daredevil: Born Again</originaltitle><year>2025</year><imdb_id>tt18923754</imdb_id><tmdbid>202555</tmdbid></tvshow>`
	if err := os.WriteFile(filepath.Join(tvRoot, "Daredevil - Born Again", "tvshow.nfo"), []byte(seriesNFO), 0o644); err != nil {
		t.Fatalf("write series nfo: %v", err)
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

	tvVideos := svc.ListVideosPage("", domain.MediaTypeTV, "", 1, 20, "", "")
	if len(tvVideos.Items) != 1 {
		t.Fatalf("expected 1 tv episode, got %d", len(tvVideos.Items))
	}
	if tvVideos.Items[0].Title != "Platform Zero" {
		t.Fatalf("expected episode title, got %q", tvVideos.Items[0].Title)
	}
	if tvVideos.Items[0].SeriesTitle != "夜魔侠：重生" || tvVideos.Items[0].SeriesOriginalTitle != "Daredevil: Born Again" {
		t.Fatalf("unexpected stored series titles: %+v", tvVideos.Items[0])
	}
	if tvVideos.Items[0].SeriesImdbID != "tt18923754" || tvVideos.Items[0].SeriesTmdbID != "202555" {
		t.Fatalf("unexpected stored series ids: %+v", tvVideos.Items[0])
	}

	chinese := svc.ListTVSeriesPage("夜魔侠", 1, 20, "", "")
	if chinese.Total != 1 || len(chinese.Items) != 1 {
		t.Fatalf("expected Chinese query to find series, total=%d items=%+v", chinese.Total, chinese.Items)
	}
	english := svc.ListTVSeriesPage("Daredevil", 1, 20, "", "")
	if english.Total != 1 || len(english.Items) != 1 {
		t.Fatalf("expected English query to find series, total=%d items=%+v", english.Total, english.Items)
	}

	row := chinese.Items[0]
	if row.Title != "夜魔侠：重生" || row.OriginalTitle != "Daredevil: Born Again" {
		t.Fatalf("unexpected series summary titles: %+v", row)
	}
	if row.ImdbID != "tt18923754" || row.TmdbID != "202555" {
		t.Fatalf("unexpected series summary ids: %+v", row)
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

func TestSubHDConfigDefaultsAndUpdate(t *testing.T) {
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
		SubHDEnabled:   true,
		SubHDBaseURL:   "https://subhd.tv",
		SubHDProxyURL:  "",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetSubHDConfig()
	if err != nil {
		t.Fatalf("get default subhd config: %v", err)
	}
	if !cfg.Enabled {
		t.Fatalf("expected subhd enabled by default")
	}
	if cfg.BaseURL != "https://subhd.tv" {
		t.Fatalf("unexpected base url: %q", cfg.BaseURL)
	}
	if cfg.Proxy != "" {
		t.Fatalf("expected empty proxy, got %q", cfg.Proxy)
	}

	saved, err := svc.UpdateSubHDConfig(domain.SubHDConfigUpdate{
		Enabled: false,
		BaseURL: "https://subhd.me",
		Proxy:   "socks5://127.0.0.1:1080",
	})
	if err != nil {
		t.Fatalf("update subhd config: %v", err)
	}
	if saved.Enabled || saved.BaseURL != "https://subhd.me" || saved.Proxy != "socks5://127.0.0.1:1080" {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
	if svc.SubHDEnabled() {
		t.Fatalf("expected client disabled after update")
	}

	_, err = svc.UpdateSubHDConfig(domain.SubHDConfigUpdate{
		Enabled: true,
		BaseURL: "ftp://bad.example",
		Proxy:   "",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid base url, got %v", err)
	}

	after, err := svc.GetSubHDConfig()
	if err != nil {
		t.Fatalf("get after invalid update: %v", err)
	}
	if after.Enabled || after.BaseURL != "https://subhd.me" {
		t.Fatalf("invalid update should not overwrite config: %+v", after)
	}
}

func TestSonarrConfigDefaultsAndUpdate(t *testing.T) {
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
		SonarrEnabled:  true,
		SonarrURL:      "http://127.0.0.1:8989",
		SonarrAPIKey:   "env-key",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetSonarrConfig()
	if err != nil {
		t.Fatalf("get default sonarr config: %v", err)
	}
	if !cfg.Enabled {
		t.Fatalf("expected sonarr enabled from env")
	}
	if cfg.URL != "http://127.0.0.1:8989" {
		t.Fatalf("unexpected url: %q", cfg.URL)
	}
	if cfg.APIKey != "env-key" {
		t.Fatalf("unexpected api key: %q", cfg.APIKey)
	}
	if !svc.SonarrEnabled() {
		t.Fatalf("expected client enabled from env")
	}

	saved, err := svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: true,
		URL:     "http://sonarr.local:8989/",
		APIKey:  "runtime-key",
	})
	if err != nil {
		t.Fatalf("update sonarr config: %v", err)
	}
	if !saved.Enabled || saved.URL != "http://sonarr.local:8989" || saved.APIKey != "runtime-key" {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
	if !svc.SonarrEnabled() {
		t.Fatalf("expected client enabled after update")
	}

	_, err = svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: true,
		URL:     "ftp://bad.example",
		APIKey:  "x",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid url, got %v", err)
	}

	_, err = svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: true,
		URL:     "http://sonarr.local:8989",
		APIKey:  "",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for missing api key, got %v", err)
	}

	disabled, err := svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: false,
		URL:     "http://sonarr.local:8989",
		APIKey:  "runtime-key",
	})
	if err != nil {
		t.Fatalf("disable sonarr: %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("expected disabled config: %+v", disabled)
	}
	if svc.SonarrEnabled() {
		t.Fatalf("expected client disabled after update")
	}

	after, err := svc.GetSonarrConfig()
	if err != nil {
		t.Fatalf("get after disable: %v", err)
	}
	if after.Enabled || after.URL != "http://sonarr.local:8989" || after.APIKey != "runtime-key" {
		t.Fatalf("unexpected config after disable: %+v", after)
	}
}

func TestJellyfinConfigDefaultsAndUpdate(t *testing.T) {
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
		MovieMediaRoot:  movieRoot,
		TVMediaRoot:     tvRoot,
		DBPath:          filepath.Join(base, "test.sqlite3"),
		JellyfinEnabled: true,
		JellyfinURL:     "http://127.0.0.1:8096",
		JellyfinAPIKey:  "env-key",
		JellyfinPathMap: "/host/movies:/data/movies",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetJellyfinConfig()
	if err != nil {
		t.Fatalf("get default jellyfin config: %v", err)
	}
	if !cfg.Enabled {
		t.Fatalf("expected jellyfin enabled from env")
	}
	if cfg.URL != "http://127.0.0.1:8096" {
		t.Fatalf("unexpected url: %q", cfg.URL)
	}
	if cfg.APIKey != "env-key" {
		t.Fatalf("unexpected api key: %q", cfg.APIKey)
	}
	if cfg.PathMap != "/host/movies:/data/movies" {
		t.Fatalf("unexpected path map: %q", cfg.PathMap)
	}
	if !svc.JellyfinEnabled() {
		t.Fatalf("expected client enabled from env")
	}

	saved, err := svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "http://jellyfin.local:8096/",
		APIKey:  "runtime-key",
		PathMap: "/a:/b,/c:/d",
	})
	if err != nil {
		t.Fatalf("update jellyfin config: %v", err)
	}
	if !saved.Enabled || saved.URL != "http://jellyfin.local:8096" || saved.APIKey != "runtime-key" {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
	if saved.PathMap != "/a:/b,/c:/d" {
		t.Fatalf("unexpected path map: %q", saved.PathMap)
	}
	if !svc.JellyfinEnabled() {
		t.Fatalf("expected client enabled after update")
	}

	_, err = svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "ftp://bad.example",
		APIKey:  "x",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid url, got %v", err)
	}

	_, err = svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "http://jellyfin.local:8096",
		APIKey:  "",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for missing api key, got %v", err)
	}

	_, err = svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "http://jellyfin.local:8096",
		APIKey:  "k",
		PathMap: "nocolon",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid path map, got %v", err)
	}

	disabled, err := svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: false,
		URL:     "http://jellyfin.local:8096",
		APIKey:  "runtime-key",
		PathMap: "/a:/b",
	})
	if err != nil {
		t.Fatalf("disable jellyfin: %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("expected disabled config: %+v", disabled)
	}
	if svc.JellyfinEnabled() {
		t.Fatalf("expected client disabled after update")
	}

	after, err := svc.GetJellyfinConfig()
	if err != nil {
		t.Fatalf("get after disable: %v", err)
	}
	if after.Enabled || after.URL != "http://jellyfin.local:8096" || after.APIKey != "runtime-key" || after.PathMap != "/a:/b" {
		t.Fatalf("unexpected config after disable: %+v", after)
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
	if created.Source != domain.SubtitleSourceGenerated || created.SourceDetail != "movie-a.zh.srt" {
		t.Fatalf("unexpected generated subtitle source: %+v", created)
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
	uploadedSRT, ok := findSubtitleByFileName(page.Items[0].Subtitles, "movie-a.zh.srt")
	if !ok {
		t.Fatalf("expected uploaded srt subtitle in refreshed page")
	}
	if uploadedSRT.Source != domain.SubtitleSourceUpload || uploadedSRT.SourceDetail != "upload.zh.srt" {
		t.Fatalf("unexpected uploaded srt source: %+v", uploadedSRT)
	}
	generatedASS, ok := findSubtitleByFileName(page.Items[0].Subtitles, "movie-a.zh.ass")
	if !ok {
		t.Fatalf("expected generated ass subtitle in refreshed page")
	}
	if generatedASS.Source != domain.SubtitleSourceGenerated || generatedASS.SourceDetail != "movie-a.zh.srt" {
		t.Fatalf("unexpected generated ass source: %+v", generatedASS)
	}
}

func TestUploadAndReplaceSubtitleSources(t *testing.T) {
	base := t.TempDir()
	svc, video := newMovieServiceFixture(t, base, "")
	defer func() {
		_ = svc.Close()
	}()

	uploadPath := filepath.Join(base, "upload.zh.srt")
	if err := os.WriteFile(uploadPath, []byte("1\n00:00:01,000 --> 00:00:02,000\nuploaded\n"), 0o644); err != nil {
		t.Fatalf("write upload source: %v", err)
	}
	uploadFile, err := os.Open(uploadPath)
	if err != nil {
		t.Fatalf("open upload source: %v", err)
	}
	defer uploadFile.Close()

	created, err := svc.UploadSubtitle(video.ID, uploadFile, &multipart.FileHeader{Filename: "upload.zh.srt"}, "zh", "")
	if err != nil {
		t.Fatalf("upload subtitle: %v", err)
	}
	if created.Source != domain.SubtitleSourceUpload || created.SourceDetail != "upload.zh.srt" {
		t.Fatalf("unexpected uploaded subtitle source: %+v", created)
	}

	replacementPath := filepath.Join(base, "replacement.zh.ass")
	if err := os.WriteFile(replacementPath, []byte("[Script Info]\n"), 0o644); err != nil {
		t.Fatalf("write replacement source: %v", err)
	}
	replacementFile, err := os.Open(replacementPath)
	if err != nil {
		t.Fatalf("open replacement source: %v", err)
	}
	defer replacementFile.Close()

	replaced, err := svc.UploadSubtitle(video.ID, replacementFile, &multipart.FileHeader{Filename: "replacement.zh.ass"}, "", created.ID)
	if err != nil {
		t.Fatalf("replace subtitle: %v", err)
	}
	if replaced.Source != domain.SubtitleSourceUpload || replaced.SourceDetail != "replacement.zh.ass" {
		t.Fatalf("unexpected replaced subtitle source: %+v", replaced)
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
	if created.Source != domain.SubtitleSourceGenerated || created.SourceDetail != "movie-a.zh.srt" {
		t.Fatalf("unexpected generated subtitle source: %+v", created)
	}
	if _, err := os.Stat(video.Subtitles[0].Path); err != nil {
		t.Fatalf("expected original srt to remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(video.Directory, "movie-a.zh.ass")); err != nil {
		t.Fatalf("expected converted ass file: %v", err)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	originalSRT, ok := findSubtitleByFileName(page.Items[0].Subtitles, "movie-a.zh.srt")
	if !ok {
		t.Fatalf("expected original srt subtitle")
	}
	if originalSRT.Source != domain.SubtitleSourceDirectory {
		t.Fatalf("expected original srt to keep directory source, got %+v", originalSRT)
	}
}

func TestDeleteSubtitleBacksUpAndLogs(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:01,000 --> 00:00:02,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected existing subtitle, got %d", len(video.Subtitles))
	}
	subtitlePath := video.Subtitles[0].Path

	if err := svc.DeleteSubtitle(video.ID, video.Subtitles[0].ID); err != nil {
		t.Fatalf("delete subtitle: %v", err)
	}
	if _, err := os.Stat(subtitlePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected subtitle file removed, stat err=%v", err)
	}
	backups, err := filepath.Glob(subtitlePath + ".bak.*")
	if err != nil {
		t.Fatalf("glob backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("expected one backup, got %d (%v)", len(backups), backups)
	}
	backupBytes, err := os.ReadFile(backups[0])
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(backupBytes) != srtContent {
		t.Fatalf("expected backup to contain original content, got %q", string(backupBytes))
	}

	deleteLog, ok := latestLogByAction(svc.ListLogs(20), "delete")
	if !ok {
		t.Fatalf("expected delete operation log")
	}
	if deleteLog.Status != "ok" || deleteLog.BackupPath == "" {
		t.Fatalf("unexpected delete log: %+v", deleteLog)
	}
	updated, found := svc.GetVideo(video.ID)
	if !found {
		t.Fatalf("expected video to remain after subtitle delete")
	}
	if len(updated.Subtitles) != 0 {
		t.Fatalf("expected no subtitles after delete, got %+v", updated.Subtitles)
	}
}

func TestRunFileScanPartialScopeDoesNotWipeOtherVideos(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	keepDir := filepath.Join(movieRoot, "Keep Movie")
	replaceDir := filepath.Join(movieRoot, "Replace Movie")
	for _, dir := range []string{keepDir, replaceDir, tvRoot} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	writeMovie := func(dir, baseName, title string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, baseName+".mkv"), []byte("video"), 0o644); err != nil {
			t.Fatalf("write video: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dir, baseName+".nfo"), []byte(sampleNFO(title, "2025")), 0o644); err != nil {
			t.Fatalf("write nfo: %v", err)
		}
	}
	writeMovie(keepDir, "keep", "Keep Movie")
	writeMovie(replaceDir, "old", "Replace Movie Old")

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

	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("initial scan: %s", status.Error)
	}
	if total := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "").Total; total != 2 {
		t.Fatalf("expected 2 movies after initial scan, got %d", total)
	}

	if err := os.Remove(filepath.Join(replaceDir, "old.mkv")); err != nil {
		t.Fatalf("remove old video: %v", err)
	}
	if err := os.Remove(filepath.Join(replaceDir, "old.nfo")); err != nil {
		t.Fatalf("remove old nfo: %v", err)
	}
	writeMovie(replaceDir, "new", "Replace Movie New")

	if status := svc.RunFileScan(context.Background(), []string{replaceDir}, nil); status.Error != "" {
		t.Fatalf("partial scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if page.Total != 2 {
		t.Fatalf("expected 2 movies after partial scan, got %d", page.Total)
	}
	titles := map[string]bool{}
	for _, item := range page.Items {
		titles[item.Title] = true
	}
	if !titles["Keep Movie"] || !titles["Replace Movie New"] || titles["Replace Movie Old"] {
		t.Fatalf("unexpected titles after partial scan: %+v", titles)
	}
}

func TestOffsetSubtitleTimingBacksUpRefreshesAndLogs(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:03,000 --> 00:00:04,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected existing subtitle, got %d", len(video.Subtitles))
	}

	updated, err := svc.OffsetSubtitleTiming(video.ID, video.Subtitles[0].ID, SubtitleTimingOffsetOptions{OffsetMS: -500})
	if err != nil {
		t.Fatalf("offset subtitle timing: %v", err)
	}
	if updated.ID != video.Subtitles[0].ID {
		t.Fatalf("expected same subtitle id after offset, got %s want %s", updated.ID, video.Subtitles[0].ID)
	}
	if updated.Source != domain.SubtitleSourceDirectory {
		t.Fatalf("expected subtitle source to be preserved, got %+v", updated)
	}

	contents, err := os.ReadFile(video.Subtitles[0].Path)
	if err != nil {
		t.Fatalf("read shifted subtitle: %v", err)
	}
	if !strings.Contains(string(contents), "00:00:02,500 --> 00:00:03,500") {
		t.Fatalf("expected shifted timing, got %q", string(contents))
	}
	backups, err := filepath.Glob(video.Subtitles[0].Path + ".bak.*")
	if err != nil {
		t.Fatalf("glob backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("expected one backup, got %d (%v)", len(backups), backups)
	}
	backupBytes, err := os.ReadFile(backups[0])
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(backupBytes) != srtContent {
		t.Fatalf("expected backup to contain original content, got %q", string(backupBytes))
	}

	offsetLog, ok := latestLogByAction(svc.ListLogs(20), "offset")
	if !ok {
		t.Fatalf("expected offset operation log")
	}
	if offsetLog.Status != "ok" || !strings.Contains(offsetLog.Message, "offset_ms=-500") {
		t.Fatalf("unexpected offset log: %+v", offsetLog)
	}
	if offsetLog.BackupPath == "" {
		t.Fatalf("expected offset log to include backup path")
	}
}

func TestOffsetSubtitleTimingRejectsInvalidRequest(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:01,000 --> 00:00:02,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()

	_, err := svc.OffsetSubtitleTiming(video.ID, video.Subtitles[0].ID, SubtitleTimingOffsetOptions{OffsetMS: -1500})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for negative resulting time, got %v", err)
	}
	contents, readErr := os.ReadFile(video.Subtitles[0].Path)
	if readErr != nil {
		t.Fatalf("read subtitle after failed offset: %v", readErr)
	}
	if string(contents) != srtContent {
		t.Fatalf("failed offset should not rewrite subtitle, got %q", string(contents))
	}
	backups, globErr := filepath.Glob(video.Subtitles[0].Path + ".bak.*")
	if globErr != nil {
		t.Fatalf("glob backups: %v", globErr)
	}
	if len(backups) != 0 {
		t.Fatalf("failed offset should not create backups, got %v", backups)
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

func TestRunFileScanSkipsUnchangedVideos(t *testing.T) {
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
		t.Fatalf("write video: %v", err)
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
	firstLog, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatalf("expected first scan log")
	}
	if !strings.Contains(firstLog.Message, "added=1") {
		t.Fatalf("expected added=1 on first scan, got %q", firstLog.Message)
	}

	status = svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("second scan status error: %s", status.Error)
	}
	secondLog, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatalf("expected second scan log")
	}
	if !strings.Contains(secondLog.Message, "skipped=1") {
		t.Fatalf("expected skipped=1 on unchanged rescan, got %q", secondLog.Message)
	}
	if !strings.Contains(secondLog.Message, "added=0") || !strings.Contains(secondLog.Message, "updated=0") {
		t.Fatalf("expected no add/update on unchanged rescan, got %q", secondLog.Message)
	}

	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.zh.srt"), []byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"), 0o644); err != nil {
		t.Fatalf("write subtitle: %v", err)
	}
	status = svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("third scan status error: %s", status.Error)
	}
	thirdLog, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatalf("expected third scan log")
	}
	if !strings.Contains(thirdLog.Message, "updated=1") {
		t.Fatalf("expected updated=1 after subtitle add, got %q", thirdLog.Message)
	}

	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 || len(page.Items[0].Subtitles) != 1 {
		t.Fatalf("expected one video with one subtitle after rescan, got %+v", page.Items)
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
	if err := svc.store.SaveScanResult([]domain.Video{video}, now, now, "", nil); err != nil {
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

func TestNormalizeSubtitlesPlanAndApply(t *testing.T) {
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
	legacySub := filepath.Join(movieDir, "movie-a.CHS.srt")
	if err := os.WriteFile(legacySub, []byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"), 0o644); err != nil {
		t.Fatalf("write sub: %v", err)
	}
	canonicalSub := filepath.Join(movieDir, "movie-a.en.srt")
	if err := os.WriteFile(canonicalSub, []byte("1\n00:00:01,000 --> 00:00:02,000\nen\n"), 0o644); err != nil {
		t.Fatalf("write en sub: %v", err)
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
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	video := page.Items[0]

	plan, err := svc.PlanNormalizeVideoSubtitles(video.ID)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	var renameItem *domain.SubtitleNormalizeItem
	var noopCount int
	for i := range plan.Items {
		item := &plan.Items[i]
		if item.Status == domain.SubtitleNormalizeRename && strings.EqualFold(item.FromFileName, "movie-a.CHS.srt") {
			renameItem = item
		}
		if item.Status == domain.SubtitleNormalizeNoop {
			noopCount++
		}
	}
	if renameItem == nil {
		t.Fatalf("expected rename for CHS subtitle, plan=%+v", plan.Items)
	}
	if renameItem.ToFileName != "movie-a.zh.srt" || renameItem.ToLabel != "zh" {
		t.Fatalf("unexpected rename target: %+v", renameItem)
	}
	if noopCount < 1 {
		t.Fatalf("expected at least one noop item for already-canonical en sub")
	}

	apply, err := svc.ApplyNormalizeVideoSubtitles(video.ID, []domain.SubtitleNormalizeApplyItem{{
		VideoID:    video.ID,
		SubtitleID: renameItem.SubtitleID,
		ToPath:     renameItem.ToPath,
	}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if apply.Renamed != 1 || apply.Failed != 0 {
		t.Fatalf("unexpected apply result: %+v", apply)
	}
	if _, err := os.Stat(legacySub); !os.IsNotExist(err) {
		t.Fatalf("legacy path should be gone, err=%v", err)
	}
	if _, err := os.Stat(renameItem.ToPath); err != nil {
		t.Fatalf("canonical path missing: %v", err)
	}

	reloaded, ok := svc.GetVideo(video.ID)
	if !ok {
		t.Fatalf("reload video")
	}
	if _, found := findSubtitleByFileName(reloaded.Subtitles, "movie-a.zh.srt"); !found {
		t.Fatalf("expected zh subtitle after rename, got %+v", reloaded.Subtitles)
	}
	// Source should remain directory after normalize refresh.
	zh, _ := findSubtitleByFileName(reloaded.Subtitles, "movie-a.zh.srt")
	if zh.Source != domain.SubtitleSourceDirectory {
		t.Fatalf("expected directory source preserved, got %q", zh.Source)
	}
}

func TestNormalizeSubtitlesDetectsBilingualFromContent(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	movieDir := filepath.Join(movieRoot, "Movie B")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	videoPath := filepath.Join(movieDir, "movie-b.mkv")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-b.nfo"), []byte(sampleNFO("Movie B", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	// Mislabeled as zh but content is bilingual.
	bilingualSRT := `1
00:00:01,000 --> 00:00:03,000
你好世界
Hello world

2
00:00:04,000 --> 00:00:06,000
再见朋友
Goodbye friend

3
00:00:07,000 --> 00:00:09,000
今天天气很好
The weather is nice today
`
	misnamed := filepath.Join(movieDir, "movie-b.zh.srt")
	if err := os.WriteFile(misnamed, []byte(bilingualSRT), 0o644); err != nil {
		t.Fatalf("write sub: %v", err)
	}
	// Legacy dash bilingual on disk.
	legacyDash := filepath.Join(movieDir, "movie-b.zh-en.ass")
	if err := os.WriteFile(legacyDash, []byte("[Script Info]\nTitle: test\n"), 0o644); err != nil {
		t.Fatalf("write ass: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = svc.Close() }()

	status := svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	video := page.Items[0]

	plan, err := svc.PlanNormalizeVideoSubtitles(video.ID)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}

	var contentUpgrade, dashFix *domain.SubtitleNormalizeItem
	for i := range plan.Items {
		item := &plan.Items[i]
		if strings.EqualFold(item.FromFileName, "movie-b.zh.srt") {
			contentUpgrade = item
		}
		if strings.EqualFold(item.FromFileName, "movie-b.zh-en.ass") {
			dashFix = item
		}
	}
	if contentUpgrade == nil {
		t.Fatalf("missing plan for mislabeled zh srt: %+v", plan.Items)
	}
	if contentUpgrade.ToLabel != "zh&en" || contentUpgrade.ToFileName != "movie-b.zh&en.srt" {
		t.Fatalf("expected content bilingual upgrade, got %+v", contentUpgrade)
	}
	if contentUpgrade.Status != domain.SubtitleNormalizeRename {
		t.Fatalf("expected rename status, got %+v", contentUpgrade)
	}
	if dashFix == nil {
		t.Fatalf("missing plan for legacy zh-en: %+v", plan.Items)
	}
	if dashFix.ToLabel != "zh&en" || dashFix.ToFileName != "movie-b.zh&en.ass" {
		t.Fatalf("expected legacy dash → zh&en, got %+v", dashFix)
	}
}

func TestSortTVSeriesSummaries(t *testing.T) {
	base := []domain.TVSeriesSummary{
		{Title: "Charlie", Path: "/tv/c", LatestEpisodeYear: "2020", UpdatedAt: "2024-01-03T00:00:00Z", VideoCount: 2, NoSubtitleCount: 1},
		{Title: "Alpha", Path: "/tv/a", LatestEpisodeYear: "2022", UpdatedAt: "2024-01-01T00:00:00Z", VideoCount: 5, NoSubtitleCount: 0},
		{Title: "Bravo", Path: "/tv/b", LatestEpisodeYear: "2021", UpdatedAt: "2024-01-02T00:00:00Z", VideoCount: 3, NoSubtitleCount: 2},
	}

	assertTitles := func(t *testing.T, items []domain.TVSeriesSummary, want []string) {
		t.Helper()
		got := make([]string, 0, len(items))
		for _, item := range items {
			got = append(got, item.Title)
		}
		if len(got) != len(want) {
			t.Fatalf("got %v want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("got %v want %v", got, want)
			}
		}
	}

	clone := func() []domain.TVSeriesSummary {
		out := make([]domain.TVSeriesSummary, len(base))
		copy(out, base)
		return out
	}

	items := clone()
	sortTVSeriesSummaries(items, "title", "asc")
	assertTitles(t, items, []string{"Alpha", "Bravo", "Charlie"})

	items = clone()
	sortTVSeriesSummaries(items, "year", "desc")
	assertTitles(t, items, []string{"Alpha", "Bravo", "Charlie"})

	items = clone()
	sortTVSeriesSummaries(items, "updatedAt", "desc")
	assertTitles(t, items, []string{"Charlie", "Bravo", "Alpha"})

	items = clone()
	sortTVSeriesSummaries(items, "videoCount", "desc")
	assertTitles(t, items, []string{"Alpha", "Bravo", "Charlie"})

	items = clone()
	sortTVSeriesSummaries(items, "noSubtitleCount", "desc")
	assertTitles(t, items, []string{"Bravo", "Charlie", "Alpha"})
}
