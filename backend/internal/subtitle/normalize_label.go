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
	if len(out) == 1 {
		return out[0]
	}
	// Stable bilingual order for deterministic filenames.
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
