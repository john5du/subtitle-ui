package subtitle

import (
	"path/filepath"
	"strings"
)

var ignoredSubtitleLanguageLabels = map[string]struct{}{
	"cc":      {},
	"default": {},
	"forced":  {},
	"foreign": {},
	"hi":      {},
	"sdh":     {},
}

var knownSubtitleLanguageLabels = map[string]struct{}{
	"ara":  {},
	"ar":   {},
	"big5": {},
	"bg":   {},
	"bul":  {},
	"ca":   {},
	"cat":  {},
	"ces":  {},
	"chi":  {},
	"chs":  {},
	"cht":  {},
	"cs":   {},
	"cze":  {},
	"da":   {},
	"dan":  {},
	"de":   {},
	"deu":  {},
	"dut":  {},
	"el":   {},
	"ell":  {},
	"en":   {},
	"eng":  {},
	"es":   {},
	"et":   {},
	"est":  {},
	"fa":   {},
	"fi":   {},
	"fin":  {},
	"fr":   {},
	"fra":  {},
	"fre":  {},
	"gb":   {},
	"ger":  {},
	"gre":  {},
	"he":   {},
	"heb":  {},
	"hin":  {},
	"hr":   {},
	"hrv":  {},
	"hu":   {},
	"hun":  {},
	"id":   {},
	"ind":  {},
	"is":   {},
	"it":   {},
	"ita":  {},
	"iw":   {},
	"ja":   {},
	"jp":   {},
	"jpn":  {},
	"ko":   {},
	"kor":  {},
	"kr":   {},
	"lt":   {},
	"lav":  {},
	"lit":  {},
	"lv":   {},
	"may":  {},
	"mul":  {},
	"ms":   {},
	"msa":  {},
	"nl":   {},
	"nld":  {},
	"no":   {},
	"nor":  {},
	"pl":   {},
	"pol":  {},
	"por":  {},
	"pt":   {},
	"ro":   {},
	"ron":  {},
	"rum":  {},
	"ru":   {},
	"rus":  {},
	"sc":   {},
	"sl":   {},
	"sk":   {},
	"slk":  {},
	"slo":  {},
	"slv":  {},
	"spa":  {},
	"sr":   {},
	"srp":  {},
	"sv":   {},
	"swe":  {},
	"ta":   {},
	"tc":   {},
	"tgl":  {},
	"th":   {},
	"tha":  {},
	"tr":   {},
	"tur":  {},
	"uk":   {},
	"ukr":  {},
	"ur":   {},
	"vi":   {},
	"vie":  {},
	"zh":   {},
	"zho":  {},
}

// InferSidecarLanguageLabel extracts language tags from a Jellyfin-style sidecar
// subtitle filename relative to its video base name (e.g. movie.zh-1.ass → zh).
// Unknown or missing tags return "und". Labels are not alias-normalized (chs stays chs).
func InferSidecarLanguageLabel(videoBase string, subtitleName string) string {
	nameNoExt := strings.TrimSuffix(subtitleName, filepath.Ext(subtitleName))
	if nameNoExt == videoBase {
		return "und"
	}

	suffix := strings.TrimPrefix(nameNoExt, videoBase)
	suffix = strings.Trim(suffix, "._- ")
	if suffix == "" {
		return "und"
	}

	suffix = trimSubtitleCollisionNumber(suffix)
	labels := inferLanguageLabelsFromSuffix(suffix)
	if len(labels) == 0 {
		return "und"
	}

	return strings.Join(labels, "&")
}

func trimSubtitleCollisionNumber(suffix string) string {
	suffix = strings.Trim(suffix, "._- ")
	separator := strings.LastIndex(suffix, "-")
	if separator <= 0 || separator == len(suffix)-1 {
		return suffix
	}
	for _, ch := range suffix[separator+1:] {
		if ch < '0' || ch > '9' {
			return suffix
		}
	}
	return strings.Trim(suffix[:separator], "._- ")
}

func inferLanguageLabelsFromSuffix(suffix string) []string {
	fields := strings.FieldsFunc(suffix, func(r rune) bool {
		return r == '.' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
	})
	labels := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	for _, field := range fields {
		for _, label := range inferLanguageLabelsFromField(field) {
			if _, ok := seen[label]; ok {
				continue
			}
			labels = append(labels, label)
			seen[label] = struct{}{}
		}
	}
	return labels
}

func inferLanguageLabelsFromField(field string) []string {
	field = strings.ToLower(strings.Trim(field, "._- "))
	if field == "" {
		return nil
	}
	if isIgnoredSubtitleLanguageLabel(field) {
		return nil
	}

	connectorParts := splitLanguageList(field, func(r rune) bool {
		return r == '&' || r == '+' || r == ',' || r == '，' || r == '＆'
	})
	if len(connectorParts) > 1 {
		if labels := parseLanguageListParts(connectorParts); len(labels) > 0 {
			return labels
		}
	}

	dashParts := splitLanguageList(field, func(r rune) bool {
		return r == '-' || r == '_'
	})
	if len(dashParts) > 1 && shouldTreatAsLanguageList(dashParts) {
		if labels := parseLanguageListParts(dashParts); len(labels) > 0 {
			return labels
		}
	}

	if label := parseSingleSidecarLanguageLabel(field); label != "" {
		return []string{label}
	}

	if len(dashParts) > 1 {
		return parseLanguageListParts(dashParts)
	}
	return nil
}

func splitLanguageList(value string, isSeparator func(rune) bool) []string {
	parts := strings.FieldsFunc(value, isSeparator)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.Trim(part, "._- ")
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func parseLanguageListParts(parts []string) []string {
	labels := make([]string, 0, len(parts))
	for _, part := range parts {
		if isIgnoredSubtitleLanguageLabel(part) {
			continue
		}
		label := parseSingleSidecarLanguageLabel(part)
		if label == "" {
			return nil
		}
		labels = append(labels, label)
	}
	return labels
}

func shouldTreatAsLanguageList(parts []string) bool {
	if len(parts) < 2 || looksLikeBCP47LanguageTag(parts) {
		return false
	}
	for _, part := range parts {
		if !isKnownSubtitleLanguageLabel(part) {
			return false
		}
	}
	return true
}

func parseSingleSidecarLanguageLabel(raw string) string {
	label := strings.ToLower(strings.Trim(raw, "._- "))
	if label == "" || isIgnoredSubtitleLanguageLabel(label) {
		return ""
	}
	label = strings.ReplaceAll(label, "_", "-")
	parts := strings.Split(label, "-")
	if len(parts) == 1 {
		if isSubtitleLanguagePrimary(parts[0]) {
			return parts[0]
		}
		return ""
	}
	if !isSubtitleLanguagePrimary(parts[0]) {
		return ""
	}
	for _, part := range parts[1:] {
		if !isBCP47Subtag(part) {
			return ""
		}
	}
	return strings.Join(parts, "-")
}

func looksLikeBCP47LanguageTag(parts []string) bool {
	if len(parts) < 2 || !isSubtitleLanguagePrimary(parts[0]) {
		return false
	}
	// Known language codes joined by '-' (zh-en, en-zh) are bilingual lists, not BCP47.
	if allPartsKnownSubtitleLanguages(parts) {
		return false
	}
	second := strings.ToLower(parts[1])
	if len(second) == 4 && isAlphaString(second) {
		return true
	}
	// Region-like 2-letter subtags only when second part is NOT itself a language primary
	// we already treat as a language list (handled above). ISO regions like CN/TW/US remain BCP47.
	if len(second) == 2 && isAlphaString(second) {
		return true
	}
	if len(second) == 3 && isDigitString(second) {
		return true
	}
	return false
}

func allPartsKnownSubtitleLanguages(parts []string) bool {
	if len(parts) < 2 {
		return false
	}
	for _, part := range parts {
		if !isKnownSubtitleLanguageLabel(part) {
			return false
		}
	}
	return true
}

func isSubtitleLanguagePrimary(label string) bool {
	label = strings.ToLower(label)
	if isIgnoredSubtitleLanguageLabel(label) {
		return false
	}
	return isKnownSubtitleLanguageLabel(label)
}

func isKnownSubtitleLanguageLabel(label string) bool {
	_, ok := knownSubtitleLanguageLabels[strings.ToLower(label)]
	return ok
}

func isIgnoredSubtitleLanguageLabel(label string) bool {
	_, ok := ignoredSubtitleLanguageLabels[strings.ToLower(label)]
	return ok
}

func isBCP47Subtag(value string) bool {
	if len(value) < 2 || len(value) > 8 {
		return false
	}
	for _, ch := range value {
		isAlpha := ch >= 'a' && ch <= 'z'
		isDigit := ch >= '0' && ch <= '9'
		if !isAlpha && !isDigit {
			return false
		}
	}
	return true
}

func isAlphaString(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		if ch < 'a' || ch > 'z' {
			return false
		}
	}
	return true
}

func isDigitString(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}
