package subtitle

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Cue is one timed subtitle entry (SRT-oriented).
type Cue struct {
	// Index is 1-based sequence number in the file order.
	Index   int      `json:"index"`
	StartMS int      `json:"startMs"`
	EndMS   int      `json:"endMs"`
	Lines   []string `json:"lines"`
}

// CueText joins cue lines with newlines (for agent display / original text).
func CueText(c Cue) string {
	return strings.Join(c.Lines, "\n")
}

// ParseSRTCues decodes subtitle bytes (auto encoding) and returns ordered cues.
func ParseSRTCues(data []byte) ([]Cue, error) {
	text, _, err := DecodeSubtitleBytes(data, DefaultSourceEncoding)
	if err != nil {
		return nil, err
	}
	return parseSRTCues(text)
}

// FormatSRTCues builds a UTF-8 SRT file from cues. Index is rewritten 1..n in order.
// Empty lines inside a cue are dropped so they cannot end the block early on re-parse.
func FormatSRTCues(cues []Cue) []byte {
	var b strings.Builder
	for i, cue := range cues {
		seq := i + 1
		b.WriteString(strconv.Itoa(seq))
		b.WriteByte('\n')
		b.WriteString(formatSRTMilliseconds(cue.StartMS))
		b.WriteString(" --> ")
		b.WriteString(formatSRTMilliseconds(cue.EndMS))
		b.WriteByte('\n')
		for _, line := range NormalizeCueLines(cue.Lines) {
			b.WriteString(line)
			b.WriteByte('\n')
		}
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

// NormalizeCueLines flattens embedded newlines and drops blank lines (SRT block separators).
func NormalizeCueLines(lines []string) []string {
	if len(lines) == 0 {
		return nil
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		for _, part := range strings.Split(normalizeNewlines(line), "\n") {
			if strings.TrimSpace(part) == "" {
				continue
			}
			out = append(out, part)
		}
	}
	return out
}

func formatSRTMilliseconds(ms int) string {
	if ms < 0 {
		ms = 0
	}
	hours := ms / 3_600_000
	ms %= 3_600_000
	minutes := ms / 60_000
	ms %= 60_000
	seconds := ms / 1000
	millis := ms % 1000
	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
}

func parseSRTCues(raw string) ([]Cue, error) {
	lines := strings.Split(normalizeNewlines(strings.TrimPrefix(raw, "\ufeff")), "\n")
	cues := make([]Cue, 0, 64)
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
			if len(cues) == 0 || isSRTSequenceNumberLine(timeLine) {
				return nil, fmt.Errorf("invalid srt time range near line %d", i+1)
			}
			orphanLines := make([]string, 0, 1)
			for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
				orphanLines = append(orphanLines, lines[i])
				i++
			}
			if len(orphanLines) > 0 {
				last := len(cues) - 1
				cues[last].Lines = append(cues[last].Lines, "")
				cues[last].Lines = append(cues[last].Lines, orphanLines...)
			}
			continue
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
		cues = append(cues, Cue{
			Index:   len(cues) + 1,
			StartMS: startMS,
			EndMS:   endMS,
			Lines:   textLines,
		})
	}
	if len(cues) == 0 {
		return nil, errors.New("srt file contains no subtitle cues")
	}
	return cues, nil
}
