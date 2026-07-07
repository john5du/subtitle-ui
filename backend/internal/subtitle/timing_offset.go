package subtitle

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const MaxTimingOffsetMilliseconds = 12 * 60 * 60 * 1000

var (
	errNoSubtitleTimings       = errors.New("subtitle contains no adjustable timings")
	arrowTimingRangePattern    = regexp.MustCompile(`(\d{1,4}:\d{2}:\d{2}[\.,]\d{1,3}|\d{1,2}:\d{2}[\.,]\d{1,3})([ \t]*-->[ \t]*)(\d{1,4}:\d{2}:\d{2}[\.,]\d{1,3}|\d{1,2}:\d{2}[\.,]\d{1,3})`)
	assEventTimePattern        = regexp.MustCompile(`^\s*(\d+):(\d{2}):(\d{2})\.(\d{1,3})\s*$`)
	assWhitespaceTrimLeftChars = " \t"
)

type arrowTimestampShape struct {
	separator byte
	hasHours  bool
	hourWidth int
}

type subtitleLine struct {
	content string
	eol     string
}

func OffsetTimingBytes(data []byte, format string, offsetMS int) ([]byte, error) {
	if offsetMS == 0 {
		return nil, errors.New("offset must not be zero")
	}
	if offsetMS < -MaxTimingOffsetMilliseconds || offsetMS > MaxTimingOffsetMilliseconds {
		return nil, fmt.Errorf("offset must be between -%d and %d milliseconds", MaxTimingOffsetMilliseconds, MaxTimingOffsetMilliseconds)
	}

	normalized := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(format), "."))
	switch normalized {
	case "srt", "vtt":
		return offsetArrowTimingBytes(data, offsetMS)
	case "ass", "ssa":
		return offsetASSTimingBytes(data, offsetMS)
	default:
		return nil, fmt.Errorf("unsupported subtitle timing format: %s", format)
	}
}

func offsetArrowTimingBytes(data []byte, offsetMS int) ([]byte, error) {
	raw := string(data)
	matches := arrowTimingRangePattern.FindAllStringSubmatchIndex(raw, -1)
	if len(matches) == 0 {
		return nil, errNoSubtitleTimings
	}

	var out strings.Builder
	out.Grow(len(raw))
	last := 0
	modified := 0
	for _, match := range matches {
		startRaw := raw[match[2]:match[3]]
		endRaw := raw[match[6]:match[7]]
		startMS, startShape, err := parseArrowTimestamp(startRaw)
		if err != nil {
			return nil, fmt.Errorf("invalid subtitle start time %q: %w", startRaw, err)
		}
		endMS, endShape, err := parseArrowTimestamp(endRaw)
		if err != nil {
			return nil, fmt.Errorf("invalid subtitle end time %q: %w", endRaw, err)
		}
		if endMS <= startMS {
			return nil, fmt.Errorf("invalid subtitle timing %q --> %q: end must be after start", startRaw, endRaw)
		}

		shiftedStart := startMS + offsetMS
		shiftedEnd := endMS + offsetMS
		if shiftedStart < 0 || shiftedEnd < 0 {
			return nil, fmt.Errorf("offset would move subtitle timing before zero")
		}
		if shiftedEnd <= shiftedStart {
			return nil, fmt.Errorf("offset would create invalid subtitle timing")
		}

		out.WriteString(raw[last:match[0]])
		out.WriteString(formatArrowTimestamp(shiftedStart, startShape))
		out.WriteString(raw[match[4]:match[5]])
		out.WriteString(formatArrowTimestamp(shiftedEnd, endShape))
		last = match[1]
		modified++
	}
	out.WriteString(raw[last:])
	if modified == 0 {
		return nil, errNoSubtitleTimings
	}
	return []byte(out.String()), nil
}

func parseArrowTimestamp(raw string) (int, arrowTimestampShape, error) {
	shape := arrowTimestampShape{separator: '.'}
	if strings.Contains(raw, ",") {
		shape.separator = ','
	}

	mainAndFraction := strings.SplitN(strings.Replace(raw, ",", ".", 1), ".", 2)
	if len(mainAndFraction) != 2 {
		return 0, shape, fmt.Errorf("missing millisecond separator")
	}
	timeParts := strings.Split(mainAndFraction[0], ":")
	if len(timeParts) != 2 && len(timeParts) != 3 {
		return 0, shape, fmt.Errorf("expected MM:SS or HH:MM:SS")
	}

	hours := 0
	minutesIndex := 0
	if len(timeParts) == 3 {
		shape.hasHours = true
		shape.hourWidth = len(timeParts[0])
		parsedHours, err := strconv.Atoi(timeParts[0])
		if err != nil {
			return 0, shape, err
		}
		hours = parsedHours
		minutesIndex = 1
	}

	minutes, err := strconv.Atoi(timeParts[minutesIndex])
	if err != nil {
		return 0, shape, err
	}
	seconds, err := strconv.Atoi(timeParts[minutesIndex+1])
	if err != nil {
		return 0, shape, err
	}
	if seconds >= 60 || (shape.hasHours && minutes >= 60) {
		return 0, shape, fmt.Errorf("minute and second values must be below 60")
	}

	milliseconds, err := parseMillisecondsFraction(mainAndFraction[1])
	if err != nil {
		return 0, shape, err
	}
	return (((hours*60+minutes)*60)+seconds)*1000 + milliseconds, shape, nil
}

func formatArrowTimestamp(milliseconds int, shape arrowTimestampShape) string {
	totalSeconds := milliseconds / 1000
	milli := milliseconds % 1000
	seconds := totalSeconds % 60
	totalMinutes := totalSeconds / 60
	minutes := totalMinutes % 60
	hours := totalMinutes / 60
	separator := "."
	if shape.separator == ',' {
		separator = ","
	}

	if !shape.hasHours && hours == 0 {
		return fmt.Sprintf("%02d:%02d%s%03d", totalMinutes, seconds, separator, milli)
	}
	hourWidth := shape.hourWidth
	if hourWidth < 2 {
		hourWidth = 2
	}
	return fmt.Sprintf("%0*d:%02d:%02d%s%03d", hourWidth, hours, minutes, seconds, separator, milli)
}

func offsetASSTimingBytes(data []byte, offsetMS int) ([]byte, error) {
	raw := string(data)
	lines := splitSubtitleLines(raw)
	if len(lines) == 0 {
		return nil, errNoSubtitleTimings
	}

	inEvents := false
	eventFieldCount := 0
	startIndex := -1
	endIndex := -1
	modified := 0
	var out strings.Builder
	out.Grow(len(raw))

	for _, line := range lines {
		content := line.content
		trimmed := strings.TrimSpace(content)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "[") && strings.HasSuffix(lower, "]") {
			inEvents = lower == "[events]"
			eventFieldCount = 0
			startIndex = -1
			endIndex = -1
			out.WriteString(content)
			out.WriteString(line.eol)
			continue
		}

		if inEvents {
			if payload, ok := splitASSEventPayload(content, "format"); ok {
				fields := strings.Split(payload, ",")
				eventFieldCount = len(fields)
				startIndex = -1
				endIndex = -1
				for index, field := range fields {
					switch strings.ToLower(strings.TrimSpace(field)) {
					case "start":
						startIndex = index
					case "end":
						endIndex = index
					}
				}
			} else if prefix, payload, ok := splitASSEventLine(content, "dialogue"); ok {
				if eventFieldCount == 0 || startIndex < 0 || endIndex < 0 {
					return nil, fmt.Errorf("ass events format must include Start and End before Dialogue")
				}
				parts := strings.SplitN(payload, ",", eventFieldCount)
				if len(parts) < eventFieldCount {
					return nil, fmt.Errorf("invalid ass dialogue: expected %d fields, got %d", eventFieldCount, len(parts))
				}

				startRaw := strings.TrimSpace(parts[startIndex])
				endRaw := strings.TrimSpace(parts[endIndex])
				startMS, err := parseASSMilliseconds(startRaw)
				if err != nil {
					return nil, fmt.Errorf("invalid ass start time %q: %w", startRaw, err)
				}
				endMS, err := parseASSMilliseconds(endRaw)
				if err != nil {
					return nil, fmt.Errorf("invalid ass end time %q: %w", endRaw, err)
				}
				if endMS <= startMS {
					return nil, fmt.Errorf("invalid ass timing %q --> %q: end must be after start", startRaw, endRaw)
				}

				shiftedStart := startMS + offsetMS
				shiftedEnd := endMS + offsetMS
				if shiftedStart < 0 || shiftedEnd < 0 {
					return nil, fmt.Errorf("offset would move subtitle timing before zero")
				}
				if shiftedEnd <= shiftedStart {
					return nil, fmt.Errorf("offset would create invalid subtitle timing")
				}

				parts[startIndex] = replaceTrimmedValue(parts[startIndex], formatASSMilliseconds(shiftedStart))
				parts[endIndex] = replaceTrimmedValue(parts[endIndex], formatASSMilliseconds(shiftedEnd))
				content = prefix + strings.Join(parts, ",")
				modified++
			}
		}

		out.WriteString(content)
		out.WriteString(line.eol)
	}

	if modified == 0 {
		return nil, errNoSubtitleTimings
	}
	return []byte(out.String()), nil
}

func splitSubtitleLines(raw string) []subtitleLine {
	if raw == "" {
		return nil
	}
	lines := make([]subtitleLine, 0, strings.Count(raw, "\n")+1)
	for start := 0; start < len(raw); {
		newline := strings.IndexByte(raw[start:], '\n')
		if newline < 0 {
			lines = append(lines, subtitleLine{content: raw[start:]})
			break
		}
		lineEnd := start + newline
		contentEnd := lineEnd
		eol := "\n"
		if contentEnd > start && raw[contentEnd-1] == '\r' {
			contentEnd--
			eol = "\r\n"
		}
		lines = append(lines, subtitleLine{content: raw[start:contentEnd], eol: eol})
		start = lineEnd + 1
	}
	return lines
}

func splitASSEventPayload(line string, eventName string) (string, bool) {
	_, payload, ok := splitASSEventLine(line, eventName)
	return payload, ok
}

func splitASSEventLine(line string, eventName string) (string, string, bool) {
	leadingLen := len(line) - len(strings.TrimLeft(line, assWhitespaceTrimLeftChars))
	rest := line[leadingLen:]
	if len(rest) <= len(eventName) || rest[len(eventName)] != ':' {
		return "", "", false
	}
	if !strings.EqualFold(rest[:len(eventName)], eventName) {
		return "", "", false
	}
	prefix := line[:leadingLen] + rest[:len(eventName)+1]
	payload := rest[len(eventName)+1:]
	return prefix, payload, true
}

func parseASSMilliseconds(raw string) (int, error) {
	match := assEventTimePattern.FindStringSubmatch(raw)
	if match == nil {
		return 0, fmt.Errorf("expected H:MM:SS.cc")
	}
	hours, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, err
	}
	minutes, err := strconv.Atoi(match[2])
	if err != nil {
		return 0, err
	}
	seconds, err := strconv.Atoi(match[3])
	if err != nil {
		return 0, err
	}
	if minutes >= 60 || seconds >= 60 {
		return 0, fmt.Errorf("minute and second values must be below 60")
	}
	milliseconds, err := parseMillisecondsFraction(match[4])
	if err != nil {
		return 0, err
	}
	return (((hours*60+minutes)*60)+seconds)*1000 + milliseconds, nil
}

func parseMillisecondsFraction(raw string) (int, error) {
	if raw == "" {
		return 0, fmt.Errorf("missing millisecond value")
	}
	trimmed := raw
	if len(trimmed) > 3 {
		trimmed = trimmed[:3]
	}
	for len(trimmed) < 3 {
		trimmed += "0"
	}
	milliseconds, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, err
	}
	return milliseconds, nil
}

func replaceTrimmedValue(raw string, value string) string {
	trimmedLeft := strings.TrimLeft(raw, assWhitespaceTrimLeftChars)
	leading := raw[:len(raw)-len(trimmedLeft)]
	trimmedBoth := strings.TrimRight(trimmedLeft, assWhitespaceTrimLeftChars)
	trailing := trimmedLeft[len(trimmedBoth):]
	return leading + value + trailing
}
