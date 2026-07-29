package subtitle

import (
	"strings"
	"testing"
)

func TestParseAndFormatSRTCuesRoundTrip(t *testing.T) {
	raw := "1\n00:00:01,000 --> 00:00:02,000\nHello\nWorld\n\n2\n00:00:03,500 --> 00:00:04,000\nBye\n"
	cues, err := ParseSRTCues([]byte(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(cues) != 2 {
		t.Fatalf("want 2 cues, got %d", len(cues))
	}
	if cues[0].Index != 1 || cues[0].StartMS != 1000 || cues[0].EndMS != 2000 {
		t.Fatalf("cue0: %+v", cues[0])
	}
	if CueText(cues[0]) != "Hello\nWorld" {
		t.Fatalf("cue text: %q", CueText(cues[0]))
	}
	if cues[1].Index != 2 || cues[1].StartMS != 3500 {
		t.Fatalf("cue1: %+v", cues[1])
	}

	out := FormatSRTCues(cues)
	again, err := ParseSRTCues(out)
	if err != nil {
		t.Fatalf("reparse: %v", err)
	}
	if len(again) != 2 || again[0].StartMS != 1000 || again[1].EndMS != 4000 {
		t.Fatalf("round-trip: %+v", again)
	}
	if !strings.Contains(string(out), "00:00:01,000 --> 00:00:02,000") {
		t.Fatalf("format missing timing: %s", out)
	}
}

func TestParseSRTCuesEmpty(t *testing.T) {
	if _, err := ParseSRTCues([]byte("\n\n")); err == nil {
		t.Fatal("expected error for empty srt")
	}
}

func TestFormatSRTCuesDropsInternalBlankLines(t *testing.T) {
	cues := []Cue{{
		Index:   1,
		StartMS: 1000,
		EndMS:   2000,
		Lines:   []string{"你好", "", "Hello\n\nWorld"},
	}}
	out := FormatSRTCues(cues)
	again, err := ParseSRTCues(out)
	if err != nil {
		t.Fatalf("reparse: %v", err)
	}
	if len(again) != 1 {
		t.Fatalf("want 1 cue after format, got %d raw=%q", len(again), out)
	}
	if len(again[0].Lines) != 3 || again[0].Lines[0] != "你好" || again[0].Lines[2] != "World" {
		t.Fatalf("lines: %+v", again[0].Lines)
	}
}
