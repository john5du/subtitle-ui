package app

import (
	"testing"

	"subtitle-ui/backend/internal/subtitle"
)

func TestReadAndInstallTranslatedCuesBilingual(t *testing.T) {
	base := t.TempDir()
	// English source SRT for bilingual zh&en output.
	svc, video := newMovieServiceFixture(t, base, "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n")
	defer func() { _ = svc.Close() }()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected 1 subtitle, got %d", len(video.Subtitles))
	}
	srcID := video.Subtitles[0].ID

	page, err := svc.ReadSubtitleCues(video.ID, srcID, 0, 10)
	if err != nil {
		t.Fatalf("read cues: %v", err)
	}
	if page.Total != 2 || len(page.Cues) != 2 {
		t.Fatalf("unexpected page: %+v", page)
	}
	if page.Cues[0].Text != "Hello" || page.Cues[1].Index != 2 {
		t.Fatalf("cues: %+v", page.Cues)
	}

	created, err := svc.InstallTranslatedCues(InstallTranslatedCuesOptions{
		VideoID:          video.ID,
		SourceSubtitleID: srcID,
		Items: []TranslatedCueItem{
			{Index: 1, Text: "你好"},
			// index 2 untranslated → keep English
		},
		Label: "zh&en",
	})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if created.ID == "" {
		t.Fatal("empty subtitle id")
	}

	data, err := svc.ReadSubtitleContent(video.ID, created.ID)
	if err != nil {
		t.Fatalf("read installed: %v", err)
	}
	cues, err := subtitle.ParseSRTCues(data)
	if err != nil {
		t.Fatalf("parse installed: %v", err)
	}
	if len(cues) != 2 {
		t.Fatalf("want 2 cues, got %d", len(cues))
	}
	// Bilingual: Chinese on top, English original below.
	if len(cues[0].Lines) != 2 || cues[0].Lines[0] != "你好" || cues[0].Lines[1] != "Hello" {
		t.Fatalf("cue0 bilingual lines: %+v", cues[0].Lines)
	}
	// Partial: untranslated keeps source.
	if subtitle.CueText(cues[1]) != "World" {
		t.Fatalf("cue1 should keep source: %+v", cues[1].Lines)
	}
}

func TestInstallTranslatedCuesBadIndex(t *testing.T) {
	base := t.TempDir()
	svc, video := newMovieServiceFixture(t, base, "1\n00:00:01,000 --> 00:00:02,000\nHi\n")
	defer func() { _ = svc.Close() }()
	srcID := video.Subtitles[0].ID
	_, err := svc.InstallTranslatedCues(InstallTranslatedCuesOptions{
		VideoID:          video.ID,
		SourceSubtitleID: srcID,
		Items:            []TranslatedCueItem{{Index: 99, Text: "x"}},
	})
	if err == nil {
		t.Fatal("expected bad index error")
	}
}
