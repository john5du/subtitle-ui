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
// used in filenames (e.g. chs → zh, eng → en, zh-cn → zh). Empty or und → "".
func NormalizeLanguageLabel(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" || raw == "und" {
		return ""
	}

	parts := splitLanguageParts(raw)
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
