package subtitle

import "testing"

func TestDetectSubtitleLanguageLabelFromName(t *testing.T) {
	tests := []struct {
		name  string
		hints []string
		want  string
	}{
		{name: "bilingual chinese", hints: []string{"双语 简体 英语.ass"}, want: "zh&en"},
		{name: "chs eng tokens", hints: []string{"Show.S01E01.chs&eng.ass"}, want: "zh&en"},
		{name: "traditional english", hints: []string{"繁体 英语"}, want: "zh-hant&en"},
		{name: "simplified only", hints: []string{"简体中文"}, want: "zh"},
		{name: "english only", hints: []string{"English.srt"}, want: "en"},
		{name: "subhd langs", hints: []string{"简体", "双语"}, want: "zh&en"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := DetectSubtitleLanguageLabel(DetectLanguageOptions{NameHints: tt.hints, DefaultLabel: "zh"})
			if got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}

func TestDetectSubtitleLanguageLabelFromContentBilingual(t *testing.T) {
	srt := `1
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
	got := DetectSubtitleLanguageLabel(DetectLanguageOptions{
		Content:      []byte(srt),
		Format:       "srt",
		DefaultLabel: "zh",
	})
	if got != "zh&en" {
		t.Fatalf("content bilingual got %q", got)
	}
}

func TestDetectSubtitleLanguageLabelExplicitWins(t *testing.T) {
	got := DetectSubtitleLanguageLabel(DetectLanguageOptions{
		ExplicitLabel: "en",
		NameHints:     []string{"双语"},
		DefaultLabel:  "zh",
	})
	if got != "en" {
		t.Fatalf("got %q", got)
	}
}

func TestDetectLanguageType(t *testing.T) {
	if got := DetectLanguageType("中英双语.ass"); got != "bilingual" {
		t.Fatalf("got %s", got)
	}
	if got := DetectLanguageType("简体.srt"); got != "simplified" {
		t.Fatalf("got %s", got)
	}
}

func TestContentUpgradesMonoNameToBilingual(t *testing.T) {
	srt := `1
00:00:01,000 --> 00:00:03,000
中文台词一行
English line one

2
00:00:04,000 --> 00:00:06,000
第二句中文
Second English line

3
00:00:07,000 --> 00:00:09,000
第三句
Third line here
`
	got := DetectSubtitleLanguageLabel(DetectLanguageOptions{
		NameHints:    []string{"episode.zh.srt"},
		Content:      []byte(srt),
		Format:       "srt",
		DefaultLabel: "zh",
	})
	if got != "zh&en" {
		t.Fatalf("expected content upgrade to zh&en, got %q", got)
	}
}
