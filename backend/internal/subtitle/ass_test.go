package subtitle

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func TestConvertSRTBytesToASSUsesTemplateAndDialogues(t *testing.T) {
	input := []byte("1\r\n00:00:01,000 --> 00:00:03,250\r\n<i>Hello</i>\r\nWorld &amp; subtitle\r\n")

	out, err := ConvertSRTBytesToASS(input, "utf-8", DefaultASSTemplate)
	if err != nil {
		t.Fatalf("convert srt to ass: %v", err)
	}
	text := string(out)
	if !strings.Contains(text, "[Events]") {
		t.Fatalf("expected events section, got %q", text)
	}
	if !strings.Contains(text, `Dialogue: 0,0:00:01.00,0:00:03.25,Default,,0,0,0,,{\i1}Hello{\i0}\NWorld & subtitle`) {
		t.Fatalf("expected converted dialogue, got %q", text)
	}
	if strings.Contains(text, ASSTemplateDialoguesPlaceholder) {
		t.Fatalf("expected placeholder to be replaced")
	}
}

func TestValidateASSTemplateRequiresDialoguesPlaceholder(t *testing.T) {
	template := strings.Replace(DefaultASSTemplate, ASSTemplateDialoguesPlaceholder, "", 1)
	if err := ValidateASSTemplate(template); err == nil {
		t.Fatalf("expected missing placeholder to be invalid")
	}
}

func TestConvertSRTBytesToASSDecodesUTF16LE(t *testing.T) {
	raw := "1\n00:00:01,000 --> 00:00:02,000\n你好\n"
	encoded := encodeUTF16LEWithBOM(raw)

	out, err := ConvertSRTBytesToASS(encoded, "auto", DefaultASSTemplate)
	if err != nil {
		t.Fatalf("convert utf-16 srt: %v", err)
	}
	if !strings.Contains(string(out), "你好") {
		t.Fatalf("expected decoded chinese text, got %q", string(out))
	}
}

func TestConvertSRTBytesToASSMergesOrphanTextBlockIntoPreviousCue(t *testing.T) {
	input := []byte("1\n00:15:02,037 --> 00:15:03,751\nRoom assignments\n\nDorm rule: no killing outside tournament\n\n2\n00:15:05,781 --> 00:15:07,541\nSocial studies\n")

	out, err := ConvertSRTBytesToASS(input, "utf-8", DefaultASSTemplate)
	if err != nil {
		t.Fatalf("convert srt with orphan text block: %v", err)
	}
	text := string(out)
	if !strings.Contains(text, `Room assignments\N\NDorm rule: no killing outside tournament`) {
		t.Fatalf("expected orphan text to be merged into previous cue, got %q", text)
	}
	if !strings.Contains(text, `Dialogue: 0,0:15:05.78,0:15:07.54`) {
		t.Fatalf("expected following cue to remain intact, got %q", text)
	}
}

func TestConvertSRTBytesToASSRejectsNumberedCueWithoutTimeRange(t *testing.T) {
	input := []byte("1\n00:00:01,000 --> 00:00:02,000\nhello\n\n2\nmissing time range\n")

	_, err := ConvertSRTBytesToASS(input, "utf-8", DefaultASSTemplate)
	if err == nil {
		t.Fatalf("expected numbered cue without time range to fail")
	}
}

func encodeUTF16LEWithBOM(raw string) []byte {
	units := utf16.Encode([]rune(raw))
	out := []byte{0xff, 0xfe}
	for _, unit := range units {
		out = append(out, byte(unit), byte(unit>>8))
	}
	return out
}
