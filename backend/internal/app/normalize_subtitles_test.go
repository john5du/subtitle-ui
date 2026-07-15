package app

import "testing"

func TestChooseNormalizeTargetLabel(t *testing.T) {
	tests := []struct {
		name     string
		base     string
		detected string
		want     string
	}{
		{name: "both empty", want: ""},
		{name: "base only", base: "zh", want: "zh"},
		{name: "detected only", detected: "en", want: "en"},
		{name: "upgrade mono to bilingual", base: "zh", detected: "zh&en", want: "zh&en"},
		{name: "keep bilingual base", base: "zh&en", detected: "zh", want: "zh&en"},
		{name: "zh to traditional", base: "zh", detected: "zh-hant", want: "zh-hant"},
		{name: "stable mono prefers base", base: "zh", detected: "en", want: "zh"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := chooseNormalizeTargetLabel(tt.base, tt.detected)
			if got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizePathKey(t *testing.T) {
	a := normalizePathKey(`/Media/Movie/film.zh.srt`)
	b := normalizePathKey(`\Media\Movie\film.zh.srt`)
	if a == "" || a != b {
		t.Fatalf("path keys should normalize separators: %q vs %q", a, b)
	}
}
