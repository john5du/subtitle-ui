package subtitle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildCanonicalSubtitlePath(t *testing.T) {
	videoPath := filepath.Join("D:\\media\\movie", "demo.mkv")
	target := BuildCanonicalSubtitlePath(videoPath, "ZH-HANS", ".SRT")
	if !strings.EqualFold(filepath.Base(target), "demo.zh-hans.srt") {
		t.Fatalf("unexpected canonical file name: %s", filepath.Base(target))
	}
}

func TestInferLabelFromSubtitlePath(t *testing.T) {
	videoPath := filepath.Join("D:\\media\\tv", "episode.mkv")
	label := InferLabelFromSubtitlePath(videoPath, filepath.Join("D:\\media\\tv", "episode.zh-CN.ass"))
	if label != "zh-cn" {
		t.Fatalf("unexpected label: %s", label)
	}
}

func TestInferLabelFromSubtitlePathReturnsEmptyForNonCanonicalName(t *testing.T) {
	videoPath := filepath.Join("D:\\media\\tv", "episode.mkv")
	label := InferLabelFromSubtitlePath(videoPath, filepath.Join("D:\\media\\tv", "legacy-name.ass"))
	if label != "" {
		t.Fatalf("expected empty label, got %s", label)
	}
}

func TestBuildNewSubtitlePathAvoidsCollision(t *testing.T) {
	root := t.TempDir()
	videoPath := filepath.Join(root, "movie.mkv")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}

	existing := filepath.Join(root, "movie.zh.srt")
	if err := os.WriteFile(existing, []byte("sub"), 0o644); err != nil {
		t.Fatalf("write existing subtitle: %v", err)
	}

	target, err := BuildNewSubtitlePath(videoPath, "zh", ".srt")
	if err != nil {
		t.Fatalf("build path: %v", err)
	}
	if !strings.EqualFold(filepath.Base(target), "movie.zh-1.srt") {
		t.Fatalf("unexpected collision fallback path: %s", filepath.Base(target))
	}
}
