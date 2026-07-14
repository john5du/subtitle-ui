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

func TestNormalizeLanguageLabel(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "", want: ""},
		{in: "und", want: ""},
		{in: "chs", want: "zh"},
		{in: "CHI", want: "zh"},
		{in: "zh-CN", want: "zh"},
		{in: "zh-Hans", want: "zh"},
		{in: "cht", want: "zh-hant"},
		{in: "zh-TW", want: "zh-hant"},
		{in: "eng", want: "en"},
		{in: "en-US", want: "en"},
		{in: "en&chs", want: "zh&en"},
		{in: "chs+en", want: "zh&en"},
		{in: "zh&en", want: "zh&en"},
		{in: "cht&eng", want: "zh-hant&en"},
		{in: "ja", want: "ja"},
		{in: "jpn", want: "ja"},
	}
	for _, tt := range tests {
		if got := NormalizeLanguageLabel(tt.in); got != tt.want {
			t.Fatalf("NormalizeLanguageLabel(%q)=%q want %q", tt.in, got, tt.want)
		}
	}
}

func TestNormalizeLabelKeepsAmpersand(t *testing.T) {
	if got := normalizeLabel("zh&en"); got != "zh&en" {
		t.Fatalf("normalizeLabel(zh&en)=%q", got)
	}
	if got := normalizeLabel("CHS+ENG"); got != "chs&eng" {
		t.Fatalf("normalizeLabel(CHS+ENG)=%q", got)
	}
	target := BuildCanonicalSubtitlePath(filepath.Join("media", "movie.mkv"), "zh&en", ".ass")
	if filepath.Base(target) != "movie.zh&en.ass" {
		t.Fatalf("unexpected bilingual path base: %s", filepath.Base(target))
	}
}

func TestIsBilingualLanguage(t *testing.T) {
	if !IsBilingualLanguage("zh&en") {
		t.Fatal("expected zh&en bilingual")
	}
	if !IsBilingualLanguage("zh-en") {
		t.Fatal("expected legacy zh-en bilingual")
	}
	if IsBilingualLanguage("zh") {
		t.Fatal("zh should not be bilingual")
	}
	if IsBilingualLanguage("zh-hant") {
		t.Fatal("zh-hant should not be bilingual")
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
