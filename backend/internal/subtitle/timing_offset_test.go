package subtitle

import (
	"strings"
	"testing"
)

func TestOffsetTimingBytesOffsetsSRTAndPreservesBody(t *testing.T) {
	input := []byte("1\r\n00:00:01,000 --> 00:00:03,250\r\nHello, subtitle\r\n\r\n2\r\n00:00:05,500 --> 00:00:06,000\r\nNext\r\n")

	out, err := OffsetTimingBytes(input, "srt", 1200)
	if err != nil {
		t.Fatalf("offset srt: %v", err)
	}
	text := string(out)
	if !strings.Contains(text, "00:00:02,200 --> 00:00:04,450") {
		t.Fatalf("expected first timing to shift, got %q", text)
	}
	if !strings.Contains(text, "00:00:06,700 --> 00:00:07,200") {
		t.Fatalf("expected second timing to shift, got %q", text)
	}
	if !strings.Contains(text, "Hello, subtitle\r\n\r\n2\r\n") {
		t.Fatalf("expected body and numbering to remain, got %q", text)
	}
}

func TestOffsetTimingBytesOffsetsSRTNegative(t *testing.T) {
	input := []byte("1\n00:00:01,000 --> 00:00:03,250\nHello\n")

	out, err := OffsetTimingBytes(input, ".srt", -500)
	if err != nil {
		t.Fatalf("offset srt negative: %v", err)
	}
	if got := string(out); !strings.Contains(got, "00:00:00,500 --> 00:00:02,750") {
		t.Fatalf("expected negative offset, got %q", got)
	}
}

func TestOffsetTimingBytesOffsetsVTTAndPreservesSettings(t *testing.T) {
	input := []byte("WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:03.000 position:50% align:start\nHello\n")

	out, err := OffsetTimingBytes(input, "vtt", 500)
	if err != nil {
		t.Fatalf("offset vtt: %v", err)
	}
	text := string(out)
	if !strings.HasPrefix(text, "WEBVTT\n\ncue-1\n") {
		t.Fatalf("expected vtt header and cue id to remain, got %q", text)
	}
	if !strings.Contains(text, "00:00:01.500 --> 00:00:03.500 position:50% align:start") {
		t.Fatalf("expected vtt timing and settings, got %q", text)
	}
}

func TestOffsetTimingBytesOffsetsASSDialogueWithoutBreakingTextCommas(t *testing.T) {
	input := []byte("[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.25,Default,,0,0,0,,Hello, subtitle\n")

	out, err := OffsetTimingBytes(input, "ass", 1200)
	if err != nil {
		t.Fatalf("offset ass: %v", err)
	}
	text := string(out)
	if !strings.Contains(text, "Dialogue: 0,0:00:02.20,0:00:04.45,Default,,0,0,0,,Hello, subtitle") {
		t.Fatalf("expected shifted ass dialogue with comma text preserved, got %q", text)
	}
}

func TestOffsetTimingBytesRejectsNegativeResult(t *testing.T) {
	input := []byte("1\n00:00:01,000 --> 00:00:02,000\nHello\n")

	_, err := OffsetTimingBytes(input, "srt", -1500)
	if err == nil {
		t.Fatalf("expected negative resulting timing to fail")
	}
}

func TestOffsetTimingBytesRejectsInvalidAndUnsupportedFormats(t *testing.T) {
	if _, err := OffsetTimingBytes([]byte("hello"), "srt", 1000); err == nil {
		t.Fatalf("expected srt with no timings to fail")
	}
	if _, err := OffsetTimingBytes([]byte("00:00:01,000 --> 00:00:02,000"), "sub", 1000); err == nil {
		t.Fatalf("expected sub format to be unsupported")
	}
}
