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
	nfo := `<movie><title>My Test Movie</title><year>2025</year></movie>`
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
	if video.Year != "2025" {
		t.Fatalf("unexpected year: %q", video.Year)
	}
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected 1 subtitle, got %d", len(video.Subtitles))
	}
	if video.Subtitles[0].Language != "zh" {
		t.Fatalf("unexpected language: %q", video.Subtitles[0].Language)
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
