package app

import (
	"path"
	"regexp"
	"strconv"
	"strings"
)

type seasonEpisode struct {
	Season  int
	Episode int
}

var (
	reSE         = regexp.MustCompile(`(?i)\bS(\d{1,2})E(\d{1,3})\b`)
	reNxNN       = regexp.MustCompile(`(?i)\b(\d{1,2})x(\d{1,3})\b`)
	reSeasonEp   = regexp.MustCompile(`(?i)\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b`)
	reEpOnly     = regexp.MustCompile(`(?i)\b(?:ep|e|episode)[\s._-]*(\d{1,3})\b`)
	reChineseEp  = regexp.MustCompile(`第\s*(\d{1,3})\s*[集话話]`)
	reSeasonOnly = regexp.MustCompile(`(?i)\b(?:season[\s._-]*(\d{1,2})|s(\d{1,2}))\b`)
	// Bare episode: "01", "01.chs", "01_简体" — leading 1–3 digits, optional tag after separator.
	reBareEpisode = regexp.MustCompile(`(?i)^0*(\d{1,3})(?:$|[._\-\s\[(].*)`)
)

const maxReasonableEpisode = 200

func parseSeasonEpisodeNumbers(text string) *seasonEpisode {
	return parseSeasonEpisodeNumbersWithDefault(text, 0)
}

// parseSeasonEpisodeNumbersWithDefault parses S/E from text. When only an episode
// number is found and defaultSeason > 0, that season is used.
func parseSeasonEpisodeNumbersWithDefault(text string, defaultSeason int) *seasonEpisode {
	for _, re := range []*regexp.Regexp{reSE, reNxNN, reSeasonEp} {
		m := re.FindStringSubmatch(text)
		if len(m) < 3 {
			continue
		}
		s, err1 := strconv.Atoi(m[1])
		e, err2 := strconv.Atoi(m[2])
		if err1 != nil || err2 != nil {
			continue
		}
		if !validEpisodeNumber(e) {
			continue
		}
		return &seasonEpisode{Season: s, Episode: e}
	}

	seasonHint := extractSeasonHint(text)
	if ep := extractEpisodeOnly(text); ep > 0 {
		season := seasonHint
		if season <= 0 {
			season = defaultSeason
		}
		if season > 0 {
			return &seasonEpisode{Season: season, Episode: ep}
		}
	}

	if ep := extractBareEpisodeNumber(text); ep > 0 {
		season := seasonHint
		if season <= 0 {
			season = defaultSeason
		}
		if season > 0 {
			return &seasonEpisode{Season: season, Episode: ep}
		}
	}

	return nil
}

func validEpisodeNumber(e int) bool {
	return e >= 1 && e <= maxReasonableEpisode
}

func extractSeasonHint(text string) int {
	m := reSeasonOnly.FindStringSubmatch(text)
	if len(m) < 3 {
		return 0
	}
	// Avoid matching the S in SxxExx already handled; still useful for "S01/01.srt".
	if reSE.MatchString(text) {
		// Prefer explicit SxxExx season if present — already returned above usually.
	}
	raw := m[1]
	if raw == "" {
		raw = m[2]
	}
	s, err := strconv.Atoi(raw)
	if err != nil || s < 0 {
		return 0
	}
	return s
}

func extractEpisodeOnly(text string) int {
	if m := reChineseEp.FindStringSubmatch(text); len(m) >= 2 {
		e, err := strconv.Atoi(m[1])
		if err == nil && validEpisodeNumber(e) {
			return e
		}
	}
	if m := reEpOnly.FindStringSubmatch(text); len(m) >= 2 {
		e, err := strconv.Atoi(m[1])
		if err == nil && validEpisodeNumber(e) {
			return e
		}
	}
	return 0
}

// extractBareEpisodeNumber looks at path segments and basename for bare episode nums
// like "01.srt", "01.chs.ass", "S01/02/xxx.srt".
func extractBareEpisodeNumber(text string) int {
	normalized := strings.ReplaceAll(text, "\\", "/")
	// Prefer file basename first, then path segments (deepest first).
	candidates := make([]string, 0, 4)
	base := path.Base(normalized)
	if base != "" && base != "." && base != "/" {
		candidates = append(candidates, stripKnownExt(base))
	}
	parts := strings.Split(normalized, "/")
	for i := len(parts) - 1; i >= 0; i-- {
		p := strings.TrimSpace(parts[i])
		if p == "" || p == base {
			continue
		}
		candidates = append(candidates, stripKnownExt(p))
	}

	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		m := reBareEpisode.FindStringSubmatch(c)
		if len(m) < 2 {
			continue
		}
		e, err := strconv.Atoi(m[1])
		if err != nil || !validEpisodeNumber(e) {
			continue
		}
		// Reject years and common non-episode numbers when the whole token is just that number.
		if e >= 1900 && e <= 2100 {
			continue
		}
		return e
	}
	return 0
}

func stripKnownExt(name string) string {
	lower := strings.ToLower(name)
	for _, ext := range []string{".ass", ".ssa", ".srt", ".vtt", ".sub", ".sup", ".idx"} {
		if strings.HasSuffix(lower, ext) {
			return name[:len(name)-len(ext)]
		}
	}
	return name
}

