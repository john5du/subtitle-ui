package scanner

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"subtitle-ui/backend/internal/domain"
)

func scanFound(t *testing.T, sc *Scanner, root string, mediaType string) []domain.Video {
	t.Helper()
	result, err := sc.ScanDirectoriesIncrementalCtx(t.Context(), []string{root}, mediaType, nil, nil)
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	return result.Found
}

func TestScanReadsVideoMetadataAndSubtitles(t *testing.T) {
	root := t.TempDir()

	videoPath := filepath.Join(root, "movie.mkv")
	subPath := filepath.Join(root, "movie.zh.srt")
	nfoPath := filepath.Join(root, "movie.nfo")

	if err := os.WriteFile(videoPath, []byte("video-data"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(subPath, []byte("subtitle-data"), 0o644); err != nil {
		t.Fatalf("write subtitle: %v", err)
	}
	nfo := `<movie><title>My Test Movie</title><originaltitle>My Test Movie Original</originaltitle><year>2025</year><imdb_id>tt1234567</imdb_id><tmdbid>7654321</tmdbid></movie>`
	if err := os.WriteFile(nfoPath, []byte(nfo), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}

	sc := New()
	videos := scanFound(t, sc, root, domain.MediaTypeMovie)
	if len(videos) != 1 {
		t.Fatalf("expected 1 video, got %d", len(videos))
	}

	video := videos[0]
	if video.Title != "My Test Movie" {
		t.Fatalf("unexpected title: %q", video.Title)
	}
	if video.OriginalTitle != "My Test Movie Original" {
		t.Fatalf("unexpected original title: %q", video.OriginalTitle)
	}
	if video.Year != "2025" {
		t.Fatalf("unexpected year: %q", video.Year)
	}
	if video.ImdbID != "tt1234567" || video.TmdbID != "7654321" {
		t.Fatalf("unexpected external ids: imdb=%q tmdb=%q", video.ImdbID, video.TmdbID)
	}
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected 1 subtitle, got %d", len(video.Subtitles))
	}
	if video.Subtitles[0].Language != "zh" {
		t.Fatalf("unexpected language: %q", video.Subtitles[0].Language)
	}
}

func TestScanTVReadsEpisodeAndSeriesMetadata(t *testing.T) {
	root := t.TempDir()
	episodeDir := filepath.Join(root, "Daredevil - Born Again", "Season 1")
	if err := os.MkdirAll(episodeDir, 0o755); err != nil {
		t.Fatalf("mkdir episode dir: %v", err)
	}

	videoPath := filepath.Join(episodeDir, "Afterlight Station S01E01.mkv")
	episodeNFOPath := filepath.Join(episodeDir, "Afterlight Station S01E01.nfo")
	seriesNFOPath := filepath.Join(root, "Daredevil - Born Again", "tvshow.nfo")
	if err := os.WriteFile(videoPath, []byte("video-data"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	episodeNFO := `<episodedetails><title>Platform Zero</title><originaltitle>Platform Zero Original</originaltitle><year>2025</year></episodedetails>`
	if err := os.WriteFile(episodeNFOPath, []byte(episodeNFO), 0o644); err != nil {
		t.Fatalf("write episode nfo: %v", err)
	}
	seriesNFO := `<tvshow><title>夜魔侠：重生</title><originaltitle>Daredevil: Born Again</originaltitle><year>2025</year><imdb_id>tt18923754</imdb_id><tmdbid>202555</tmdbid></tvshow>`
	if err := os.WriteFile(seriesNFOPath, []byte(seriesNFO), 0o644); err != nil {
		t.Fatalf("write series nfo: %v", err)
	}

	sc := New()
	videos := scanFound(t, sc, root, domain.MediaTypeTV)
	if len(videos) != 1 {
		t.Fatalf("expected 1 video, got %d", len(videos))
	}

	video := videos[0]
	if video.Title != "Platform Zero" {
		t.Fatalf("expected episode title, got %q", video.Title)
	}
	if video.OriginalTitle != "Platform Zero Original" {
		t.Fatalf("unexpected episode original title: %q", video.OriginalTitle)
	}
	if video.SeriesTitle != "夜魔侠：重生" {
		t.Fatalf("unexpected series title: %q", video.SeriesTitle)
	}
	if video.SeriesOriginalTitle != "Daredevil: Born Again" {
		t.Fatalf("unexpected series original title: %q", video.SeriesOriginalTitle)
	}
	if video.SeriesImdbID != "tt18923754" || video.SeriesTmdbID != "202555" {
		t.Fatalf("unexpected series external ids: imdb=%q tmdb=%q", video.SeriesImdbID, video.SeriesTmdbID)
	}
}

func TestScanSkipsVideoWithoutNFO(t *testing.T) {
	root := t.TempDir()
	videoPath := filepath.Join(root, "movie_without_nfo.mkv")

	if err := os.WriteFile(videoPath, []byte("video-data"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	sc := New()
	videos := scanFound(t, sc, root, domain.MediaTypeMovie)
	if len(videos) != 0 {
		t.Fatalf("expected 0 videos when nfo is missing, got %d", len(videos))
	}
}

func TestComputeMediaFingerprintStableAndSensitive(t *testing.T) {
	root := t.TempDir()
	videoPath := filepath.Join(root, "movie.mkv")
	nfoPath := filepath.Join(root, "movie.nfo")
	subPath := filepath.Join(root, "movie.zh.srt")
	posterPath := filepath.Join(root, "poster.jpg")

	if err := os.WriteFile(videoPath, []byte("video-data"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(nfoPath, []byte(`<movie><title>Movie</title></movie>`), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	if err := os.WriteFile(subPath, []byte("sub"), 0o644); err != nil {
		t.Fatalf("write sub: %v", err)
	}
	if err := os.WriteFile(posterPath, []byte("poster"), 0o644); err != nil {
		t.Fatalf("write poster: %v", err)
	}

	fp1, size1, _, err := ComputeMediaFingerprint(videoPath, "movie", posterPath)
	if err != nil {
		t.Fatalf("fingerprint: %v", err)
	}
	fp2, size2, _, err := ComputeMediaFingerprint(videoPath, "movie", posterPath)
	if err != nil {
		t.Fatalf("fingerprint 2: %v", err)
	}
	if fp1 == "" || fp1 != fp2 {
		t.Fatalf("expected stable fingerprint, got %q vs %q", fp1, fp2)
	}
	if size1 != size2 || size1 <= 0 {
		t.Fatalf("unexpected size: %d %d", size1, size2)
	}

	if err := os.WriteFile(subPath, []byte("sub-changed"), 0o644); err != nil {
		t.Fatalf("rewrite sub: %v", err)
	}
	fpSub, _, _, err := ComputeMediaFingerprint(videoPath, "movie", posterPath)
	if err != nil {
		t.Fatalf("fingerprint after sub: %v", err)
	}
	if fpSub == fp1 {
		t.Fatalf("expected subtitle change to alter fingerprint")
	}

	if err := os.WriteFile(nfoPath, []byte(`<movie><title>Movie 2</title></movie>`), 0o644); err != nil {
		t.Fatalf("rewrite nfo: %v", err)
	}
	fpNFO, _, _, err := ComputeMediaFingerprint(videoPath, "movie", posterPath)
	if err != nil {
		t.Fatalf("fingerprint after nfo: %v", err)
	}
	if fpNFO == fpSub {
		t.Fatalf("expected nfo change to alter fingerprint")
	}

	fpNoPoster, _, _, err := ComputeMediaFingerprint(videoPath, "movie", "")
	if err != nil {
		t.Fatalf("fingerprint without poster: %v", err)
	}
	if fpNoPoster == fpNFO {
		t.Fatalf("expected poster presence to alter fingerprint")
	}
}

func TestScanDirectoriesIncrementalSkipsUnchanged(t *testing.T) {
	root := t.TempDir()
	videoPath := filepath.Join(root, "movie.mkv")
	nfoPath := filepath.Join(root, "movie.nfo")
	if err := os.WriteFile(videoPath, []byte("video-data"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(nfoPath, []byte(`<movie><title>My Test Movie</title><year>2025</year></movie>`), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}

	sc := New()
	firstResult, err := sc.ScanDirectoriesIncrementalCtx(t.Context(), []string{root}, "movie", nil, nil)
	if err != nil {
		t.Fatalf("first scan: %v", err)
	}
	first := firstResult.Found
	if len(first) != 1 {
		t.Fatalf("expected 1 video, got %d", len(first))
	}

	fp, size, modTime, err := ComputeMediaFingerprint(first[0].Path, "movie", "")
	if err != nil {
		t.Fatalf("fingerprint: %v", err)
	}
	prev := first[0]
	prev.ScanFingerprint = fp
	prev.FileSize = size
	prev.FileModTime = modTime
	previous := map[string]domain.Video{prev.Path: prev}

	second, err := sc.ScanDirectoriesIncrementalCtx(
		t.Context(),
		[]string{root},
		"movie",
		previous,
		func(videoPath string, mediaType string) (string, int64, time.Time, error) {
			return ComputeMediaFingerprint(videoPath, mediaType, "")
		},
	)
	if err != nil {
		t.Fatalf("incremental scan: %v", err)
	}
	if second.Stats.Skipped != 1 || second.Stats.Rebuilt != 0 || second.Stats.Found != 1 {
		t.Fatalf("unexpected stats: %+v", second.Stats)
	}
	if len(second.Rebuilt) != 0 {
		t.Fatalf("expected no rebuilt paths, got %v", second.Rebuilt)
	}

	if err := os.WriteFile(filepath.Join(root, "movie.zh.srt"), []byte("sub"), 0o644); err != nil {
		t.Fatalf("write sub: %v", err)
	}
	third, err := sc.ScanDirectoriesIncrementalCtx(
		t.Context(),
		[]string{root},
		"movie",
		previous,
		func(videoPath string, mediaType string) (string, int64, time.Time, error) {
			return ComputeMediaFingerprint(videoPath, mediaType, "")
		},
	)
	if err != nil {
		t.Fatalf("incremental scan after sub: %v", err)
	}
	if third.Stats.Rebuilt != 1 || third.Stats.Skipped != 0 {
		t.Fatalf("expected rebuild after subtitle add, got %+v", third.Stats)
	}
	if len(third.Found) != 1 || len(third.Found[0].Subtitles) != 1 {
		t.Fatalf("expected rebuilt video with subtitle, got %+v", third.Found)
	}
}


