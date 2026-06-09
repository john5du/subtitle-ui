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

func encodeUTF16LEWithBOM(raw string) []byte {
	units := utf16.Encode([]rune(raw))
	out := []byte{0xff, 0xfe}
	for _, unit := range units {
		out = append(out, byte(unit), byte(unit>>8))
	}
	return out
}
