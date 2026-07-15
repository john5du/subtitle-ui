package subtitle

import "testing"

func TestInferSidecarLanguageLabel(t *testing.T) {
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
			name:         "legacy dash bilingual label",
			videoBase:    "movie",
			subtitleName: "movie.zh-en.ass",
			want:         "zh&en",
		},
		{
			name:         "legacy dash bilingual en-zh",
			videoBase:    "movie",
			subtitleName: "movie.en-zh.ass",
			want:         "en&zh",
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
			if got := InferSidecarLanguageLabel(tt.videoBase, tt.subtitleName); got != tt.want {
				t.Fatalf("InferSidecarLanguageLabel(%q, %q) = %q, want %q", tt.videoBase, tt.subtitleName, got, tt.want)
			}
		})
	}
}
