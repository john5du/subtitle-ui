package subtitle

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

const (
	ASSTemplateDialoguesPlaceholder = "{{DIALOGUES}}"
	DefaultSourceEncoding           = "auto"
)

const DefaultASSTemplate = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
{{DIALOGUES}}
`

var (
	errInvalidASSTemplate = errors.New("invalid ass template")
	srtTimeRangePattern   = regexp.MustCompile(`^\s*([0-9]+:[0-9]{2}:[0-9]{2}[\.,][0-9]{1,3})\s*-->\s*([0-9]+:[0-9]{2}:[0-9]{2}[\.,][0-9]{1,3})(?:\s+.*)?$`)
	italicOpenPattern     = regexp.MustCompile(`(?i)<\s*i\s*>`)
	italicClosePattern    = regexp.MustCompile(`(?i)<\s*/\s*i\s*>`)
	boldOpenPattern       = regexp.MustCompile(`(?i)<\s*b\s*>`)
	boldClosePattern      = regexp.MustCompile(`(?i)<\s*/\s*b\s*>`)
	underlineOpenPattern  = regexp.MustCompile(`(?i)<\s*u\s*>`)
	underlineClosePattern = regexp.MustCompile(`(?i)<\s*/\s*u\s*>`)
	htmlTagPattern        = regexp.MustCompile(`(?s)<[^>]+>`)
)

type srtCue struct {
	StartMS int
	EndMS   int
	Lines   []string
}

func ValidateASSTemplate(template string) error {
	trimmed := strings.TrimSpace(template)
	if trimmed == "" {
		return fmt.Errorf("%w: template is empty", errInvalidASSTemplate)
	}
	if !strings.Contains(trimmed, ASSTemplateDialoguesPlaceholder) {
		return fmt.Errorf("%w: missing %s placeholder", errInvalidASSTemplate, ASSTemplateDialoguesPlaceholder)
	}
	if !hasASSSection(trimmed, "events") {
		return fmt.Errorf("%w: missing [Events] section", errInvalidASSTemplate)
	}
	fields := assEventsFormatFields(trimmed)
	expected := []string{"layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"}
	if len(fields) != len(expected) {
		return fmt.Errorf("%w: events format must be Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", errInvalidASSTemplate)
	}
	for i := range expected {
		if fields[i] != expected[i] {
			return fmt.Errorf("%w: events format must be Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", errInvalidASSTemplate)
		}
	}
	return nil
}

func NormalizeSourceEncoding(raw string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	if normalized == "" {
		normalized = DefaultSourceEncoding
	}
	switch normalized {
	case "auto":
		return "auto", nil
	case "utf8", "utf-8":
		return "utf-8", nil
	case "utf16le", "utf-16le":
		return "utf-16le", nil
	case "utf16be", "utf-16be":
		return "utf-16be", nil
	case "gb18030", "gbk", "gb2312":
		return "gb18030", nil
	case "big5", "big-5":
		return "big5", nil
	default:
		return "", fmt.Errorf("unsupported subtitle source encoding: %s", raw)
	}
}

func ConvertSRTBytesToASS(data []byte, sourceEncoding string, assTemplate string) ([]byte, error) {
	if err := ValidateASSTemplate(assTemplate); err != nil {
		return nil, err
	}

	text, _, err := DecodeSubtitleBytes(data, sourceEncoding)
	if err != nil {
		return nil, err
	}
	cues, err := parseSRTCues(text)
	if err != nil {
		return nil, err
	}

	dialogues := make([]string, 0, len(cues))
	for _, cue := range cues {
		dialogues = append(dialogues, fmt.Sprintf(
			"Dialogue: 0,%s,%s,Default,,0,0,0,,%s",
			formatASSMilliseconds(cue.StartMS),
			formatASSMilliseconds(cue.EndMS),
			formatASSText(cue.Lines),
		))
	}

	out := strings.Replace(assTemplate, ASSTemplateDialoguesPlaceholder, strings.Join(dialogues, "\n"), 1)
	if !strings.HasSuffix(out, "\n") {
		out += "\n"
	}
	return []byte(out), nil
}

func DecodeSubtitleBytes(data []byte, sourceEncoding string) (string, string, error) {
	encodingName, err := NormalizeSourceEncoding(sourceEncoding)
	if err != nil {
		return "", "", err
	}

	if encodingName == "auto" {
		switch {
		case bytes.HasPrefix(data, []byte{0xff, 0xfe}):
			text, err := decodeUTF16(data, binary.LittleEndian, true)
			return text, "utf-16le", err
		case bytes.HasPrefix(data, []byte{0xfe, 0xff}):
			text, err := decodeUTF16(data, binary.BigEndian, true)
			return text, "utf-16be", err
		case bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}):
			return string(data[3:]), "utf-8", nil
		case utf8.Valid(data):
			return string(data), "utf-8", nil
		}
		if text, err := decodeGB18030(data); err == nil {
			return text, "gb18030", nil
		}
		if text, err := decodeBig5(data); err == nil {
			return text, "big5", nil
		}
		return "", "", errors.New("unable to decode subtitle content; select a source encoding")
	}

	switch encodingName {
	case "utf-8":
		payload := bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
		if !utf8.Valid(payload) {
			return "", "", errors.New("subtitle content is not valid utf-8")
		}
		return string(payload), encodingName, nil
	case "utf-16le":
		text, err := decodeUTF16(data, binary.LittleEndian, true)
		return text, encodingName, err
	case "utf-16be":
		text, err := decodeUTF16(data, binary.BigEndian, true)
		return text, encodingName, err
	case "gb18030":
		text, err := decodeGB18030(data)
		return text, encodingName, err
	case "big5":
		text, err := decodeBig5(data)
		return text, encodingName, err
	default:
		return "", "", fmt.Errorf("unsupported subtitle source encoding: %s", sourceEncoding)
	}
}

func hasASSSection(template string, sectionName string) bool {
	needle := "[" + strings.ToLower(sectionName) + "]"
	for _, line := range strings.Split(normalizeNewlines(template), "\n") {
		if strings.ToLower(strings.TrimSpace(line)) == needle {
			return true
		}
	}
	return false
}

func assEventsFormatFields(template string) []string {
	inEvents := false
	for _, line := range strings.Split(normalizeNewlines(template), "\n") {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "[") && strings.HasSuffix(lower, "]") {
			inEvents = lower == "[events]"
			continue
		}
		if !inEvents || !strings.HasPrefix(lower, "format:") {
			continue
		}
		rawFields := strings.Split(strings.TrimSpace(trimmed[len("Format:"):]), ",")
		fields := make([]string, 0, len(rawFields))
		for _, field := range rawFields {
			fields = append(fields, strings.ToLower(strings.TrimSpace(field)))
		}
		return fields
	}
	return nil
}

func parseSRTCues(raw string) ([]srtCue, error) {
	lines := strings.Split(normalizeNewlines(strings.TrimPrefix(raw, "\ufeff")), "\n")
	cues := make([]srtCue, 0, 64)
	for i := 0; i < len(lines); {
		for i < len(lines) && strings.TrimSpace(lines[i]) == "" {
			i++
		}
		if i >= len(lines) {
			break
		}

		timeLine := lines[i]
		if !strings.Contains(timeLine, "-->") && i+1 < len(lines) && strings.Contains(lines[i+1], "-->") {
			i++
			timeLine = lines[i]
		}
		match := srtTimeRangePattern.FindStringSubmatch(timeLine)
		if match == nil {
			return nil, fmt.Errorf("invalid srt time range near line %d", i+1)
		}
		startMS, err := parseSRTMilliseconds(match[1])
		if err != nil {
			return nil, fmt.Errorf("invalid srt start time near line %d: %w", i+1, err)
		}
		endMS, err := parseSRTMilliseconds(match[2])
		if err != nil {
			return nil, fmt.Errorf("invalid srt end time near line %d: %w", i+1, err)
		}
		if endMS <= startMS {
			return nil, fmt.Errorf("invalid srt time range near line %d: end must be after start", i+1)
		}
		i++

		textLines := make([]string, 0, 2)
		for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
			textLines = append(textLines, lines[i])
			i++
		}
		cues = append(cues, srtCue{StartMS: startMS, EndMS: endMS, Lines: textLines})
	}
	if len(cues) == 0 {
		return nil, errors.New("srt file contains no subtitle cues")
	}
	return cues, nil
}

func parseSRTMilliseconds(raw string) (int, error) {
	mainAndMilli := strings.SplitN(strings.Replace(raw, ",", ".", 1), ".", 2)
	if len(mainAndMilli) != 2 {
		return 0, fmt.Errorf("missing millisecond separator")
	}
	timeParts := strings.Split(mainAndMilli[0], ":")
	if len(timeParts) != 3 {
		return 0, fmt.Errorf("expected HH:MM:SS")
	}
	hours, err := strconv.Atoi(timeParts[0])
	if err != nil {
		return 0, err
	}
	minutes, err := strconv.Atoi(timeParts[1])
	if err != nil {
		return 0, err
	}
	seconds, err := strconv.Atoi(timeParts[2])
	if err != nil {
		return 0, err
	}
	milliRaw := mainAndMilli[1]
	if len(milliRaw) > 3 {
		milliRaw = milliRaw[:3]
	}
	for len(milliRaw) < 3 {
		milliRaw += "0"
	}
	milliseconds, err := strconv.Atoi(milliRaw)
	if err != nil {
		return 0, err
	}
	if minutes >= 60 || seconds >= 60 {
		return 0, fmt.Errorf("minute and second values must be below 60")
	}
	return (((hours*60+minutes)*60)+seconds)*1000 + milliseconds, nil
}

func formatASSMilliseconds(milliseconds int) string {
	totalCentiseconds := (milliseconds + 5) / 10
	totalSeconds := totalCentiseconds / 100
	centiseconds := totalCentiseconds % 100
	seconds := totalSeconds % 60
	totalMinutes := totalSeconds / 60
	minutes := totalMinutes % 60
	hours := totalMinutes / 60
	return fmt.Sprintf("%d:%02d:%02d.%02d", hours, minutes, seconds, centiseconds)
}

func formatASSText(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = append(out, convertInlineSRTText(line))
	}
	return strings.Join(out, `\N`)
}

func convertInlineSRTText(line string) string {
	line = html.UnescapeString(line)
	line = italicOpenPattern.ReplaceAllString(line, `{\i1}`)
	line = italicClosePattern.ReplaceAllString(line, `{\i0}`)
	line = boldOpenPattern.ReplaceAllString(line, `{\b1}`)
	line = boldClosePattern.ReplaceAllString(line, `{\b0}`)
	line = underlineOpenPattern.ReplaceAllString(line, `{\u1}`)
	line = underlineClosePattern.ReplaceAllString(line, `{\u0}`)
	line = htmlTagPattern.ReplaceAllString(line, "")
	return strings.TrimSpace(line)
}

func normalizeNewlines(raw string) string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	return strings.ReplaceAll(raw, "\r", "\n")
}

func decodeUTF16(data []byte, order binary.ByteOrder, trimBOM bool) (string, error) {
	if trimBOM {
		if bytes.HasPrefix(data, []byte{0xff, 0xfe}) || bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
			data = data[2:]
		}
	}
	if len(data)%2 != 0 {
		return "", errors.New("utf-16 subtitle content has an odd byte length")
	}
	units := make([]uint16, len(data)/2)
	for i := range units {
		units[i] = order.Uint16(data[i*2 : i*2+2])
	}
	return string(utf16.Decode(units)), nil
}

func decodeGB18030(data []byte) (string, error) {
	out, err := simplifiedchinese.GB18030.NewDecoder().Bytes(data)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func decodeBig5(data []byte) (string, error) {
	out, err := traditionalchinese.Big5.NewDecoder().Bytes(data)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
