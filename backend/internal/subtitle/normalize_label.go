package subtitle

import (
	"sort"
	"strings"
)

// shortLanguageAliases maps common language tags to short Jellyfin-friendly codes.
var shortLanguageAliases = map[string]string{
	"chs":     "zh",
	"chi":     "zh",
	"sc":      "zh",
	"zho":     "zh",
	"zh-cn":   "zh",
	"zh-hans": "zh",
	"gb":      "zh",
	"cht":     "zh-hant",
	"tc":      "zh-hant",
	"zh-tw":   "zh-hant",
	"zh-hant": "zh-hant",
	"zh-hk":   "zh-hant",
	"eng":     "en",
	"en-us":   "en",
	"en-gb":   "en",
	"jpn":     "ja",
	"jp":      "ja",
	"kor":     "ko",
	"kr":      "ko",
	"fre":     "fr",
	"fra":     "fr",
	"ger":     "de",
	"deu":     "de",
	"spa":     "es",
	"por":     "pt",
	"rus":     "ru",
}

// NormalizeLanguageLabel maps scanner/path language tags to short canonical labels
// used in filenames (e.g. chs → zh, eng → en, zh-cn → zh, zh-en → zh&en). Empty or und → "".
func NormalizeLanguageLabel(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || raw == "und" {
		return ""
	}

	parts := expandLanguageParts(raw)
	if len(parts) == 0 {
		return ""
	}

	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		mapped := mapSingleLanguageTag(part)
		if mapped == "" {
			continue
		}
		if _, ok := seen[mapped]; ok {
			continue
		}
		seen[mapped] = struct{}{}
		out = append(out, mapped)
	}
	if len(out) == 0 {
		return ""
	}
	return joinCanonicalLanguageLabels(out)
}

// expandLanguageParts splits multi-language tags, including legacy dash form zh-en.
func expandLanguageParts(raw string) []string {
	parts := splitLanguageParts(raw)
	out := make([]string, 0, len(parts)+1)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if dashParts := splitDashLanguageList(part); len(dashParts) > 1 {
			out = append(out, dashParts...)
			continue
		}
		out = append(out, part)
	}
	return out
}

// splitDashLanguageList returns language primaries when part is like zh-en / en-chs
// (not BCP47 zh-hant / zh-cn / en-us).
func splitDashLanguageList(part string) []string {
	part = strings.ToLower(strings.TrimSpace(part))
	if part == "" || !strings.Contains(part, "-") {
		return nil
	}
	// Whole-tag aliases first (zh-cn, zh-hant, en-us).
	normalized := normalizeLabel(part)
	if _, ok := shortLanguageAliases[part]; ok {
		return nil
	}
	if _, ok := shortLanguageAliases[normalized]; ok {
		return nil
	}
	dashParts := strings.Split(part, "-")
	if len(dashParts) < 2 {
		return nil
	}
	// BCP47 script/region: zh-hant, zh-hans, zh-cn, en-us, ...
	second := dashParts[1]
	if second == "hant" || second == "hans" || second == "cn" || second == "tw" || second == "hk" ||
		second == "us" || second == "gb" || second == "sg" {
		return nil
	}
	mapped := make([]string, 0, len(dashParts))
	for _, p := range dashParts {
		m := mapPrimaryLanguageToken(p)
		if m == "" {
			return nil
		}
		mapped = append(mapped, m)
	}
	if len(mapped) < 2 {
		return nil
	}
	return mapped
}

func mapPrimaryLanguageToken(token string) string {
	token = strings.ToLower(strings.TrimSpace(token))
	if token == "" {
		return ""
	}
	if mapped, ok := shortLanguageAliases[token]; ok {
		return mapped
	}
	switch token {
	case "zh", "en", "ja", "ko", "fr", "de", "es", "pt", "ru", "it", "ar", "th", "vi", "id", "ms", "nl", "pl", "tr", "sv", "no", "da", "fi", "cs", "hu", "ro", "uk", "he", "hi":
		return token
	case "chs", "chi", "sc":
		return "zh"
	case "cht", "tc":
		return "zh-hant"
	case "eng":
		return "en"
	case "jpn", "jp":
		return "ja"
	case "kor", "kr":
		return "ko"
	default:
		return ""
	}
}

// IsBilingualLanguage reports whether a stored language tag is multi-language.
func IsBilingualLanguage(raw string) bool {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || raw == "und" {
		return false
	}
	parts := splitLanguageParts(raw)
	if len(parts) > 1 {
		// zh-hant is a single BCP47-style tag (no '&'); splitLanguageParts keeps it whole.
		mapped := make([]string, 0, len(parts))
		seen := make(map[string]struct{}, len(parts))
		for _, p := range parts {
			m := mapSingleLanguageTag(p)
			if m == "" {
				continue
			}
			if _, ok := seen[m]; ok {
				continue
			}
			seen[m] = struct{}{}
			mapped = append(mapped, m)
		}
		return len(mapped) >= 2
	}
	// Legacy on-disk form after older sanitize: zh-en / en-zh (not zh-hant / zh-cn).
	if strings.Contains(raw, "-") {
		dashParts := strings.Split(raw, "-")
		if len(dashParts) < 2 {
			return false
		}
		// Script/region subtags are single-language BCP47.
		second := dashParts[1]
		if second == "hant" || second == "hans" || second == "cn" || second == "tw" || second == "hk" ||
			second == "us" || second == "gb" || second == "sg" {
			return false
		}
		mapped := make([]string, 0, len(dashParts))
		seen := make(map[string]struct{}, len(dashParts))
		for _, p := range dashParts {
			// Only count known short language primaries, not random subtags.
			m := mapSingleLanguageTag(p)
			if m == "" || m == p && len(p) > 3 {
				// Unknown long tags are not language primaries.
				if _, ok := shortLanguageAliases[p]; !ok && p != "zh" && p != "en" && p != "ja" && p != "ko" &&
					p != "fr" && p != "de" && p != "es" && p != "pt" && p != "ru" {
					continue
				}
			}
			if m == "" {
				continue
			}
			if _, ok := seen[m]; ok {
				continue
			}
			seen[m] = struct{}{}
			mapped = append(mapped, m)
		}
		return len(mapped) >= 2
	}
	return false
}

// joinCanonicalLanguageLabels prefers Chinese-first zh&en / zh-hant&en.
func joinCanonicalLanguageLabels(out []string) string {
	if len(out) == 1 {
		return out[0]
	}
	hasEn, hasZh, hasZhHant := false, false, false
	others := make([]string, 0, len(out))
	for _, tag := range out {
		switch tag {
		case "en":
			hasEn = true
		case "zh":
			hasZh = true
		case "zh-hant":
			hasZhHant = true
		default:
			others = append(others, tag)
		}
	}
	if hasEn && len(others) == 0 && (hasZh || hasZhHant) {
		if hasZh && hasZhHant {
			return "zh&zh-hant&en"
		}
		if hasZhHant {
			return "zh-hant&en"
		}
		return "zh&en"
	}
	sort.Strings(out)
	return strings.Join(out, "&")
}

func splitLanguageParts(raw string) []string {
	replacer := strings.NewReplacer("+", "&", ",", "&", "/", "&", "|", "&")
	normalized := replacer.Replace(raw)
	chunks := strings.Split(normalized, "&")
	out := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		part := strings.TrimSpace(chunk)
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}

func mapSingleLanguageTag(tag string) string {
	tag = normalizeLabel(tag)
	if tag == "" || tag == "und" {
		return ""
	}
	if mapped, ok := shortLanguageAliases[tag]; ok {
		return mapped
	}
	// zh alone stays zh; other short codes pass through if already clean.
	return tag
}
