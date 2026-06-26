package scanner

import (
	"os"
	"path/filepath"
	"testing"
)

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
	videos, err := sc.Scan(root)
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
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
	videos, err := sc.ScanWithType(root, "tv")
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
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
	videos, err := sc.Scan(root)
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	if len(videos) != 0 {
		t.Fatalf("expected 0 videos when nfo is missing, got %d", len(videos))
	}
}

func TestInferLanguageFromSubtitleName(t *testing.T) {
	tests := []struct {
		name         string
		videoBase    string
		subtitleName string
		want         string
	}{
		{
			name:         "collision suffix keeps language",
			videoBase:    "movie",
			subtitleName: "movie.zh-1.ass",
			want:         "zh",
		},
		{
			name:         "release suffix before language",
			videoBase:    "Twisted Metal - S02E02",
			subtitleName: "Twisted Metal - S02E02 - DOLF4C3 HDTV-1080p x265 AC3.zh-1.ass",
			want:         "zh",
		},
		{
			name:         "ampersand bilingual label",
			videoBase:    "Spider-Noir.S01E05.Betrayal.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-FLUX",
			subtitleName: "Spider-Noir.S01E05.Betrayal.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-FLUX.EN&CHS.ass",
			want:         "en&chs",
		},
		{
			name:         "bcp47 script label",
			videoBase:    "movie",
			subtitleName: "movie.zh-Hans.ass",
			want:         "zh-hans",
		},
		{
			name:         "bcp47 underscore script label",
			videoBase:    "movie",
			subtitleName: "movie.zh_Hant.ass",
			want:         "zh-hant",
		},
		{
			name:         "media flags are ignored",
			videoBase:    "movie",
			subtitleName: "movie.default.en.forced.ass",
			want:         "en",
		},
		{
			name:         "dot separated bilingual label",
			videoBase:    "movie",
			subtitleName: "movie.en.chs.ass",
			want:         "en&chs",
		},
		{
			name:         "bilingual collision suffix",
			videoBase:    "movie",
			subtitleName: "movie.en&chs-2.ass",
			want:         "en&chs",
		},
		{
			name:         "no language label",
			videoBase:    "movie",
			subtitleName: "movie.ass",
			want:         "und",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := inferLanguage(tt.videoBase, tt.subtitleName); got != tt.want {
				t.Fatalf("inferLanguage(%q, %q) = %q, want %q", tt.videoBase, tt.subtitleName, got, tt.want)
			}
		})
	}
}
