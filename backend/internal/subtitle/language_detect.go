package subtitle

import (
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

const contentSampleMaxCues = 40

var (
	bilingualNamePattern   = regexp.MustCompile(`(?i)双语|bilingual|中英|简英|繁英|(?:chs|cht|zh)[._\-\s&+]*(?:en|eng)|(?:en|eng)[._\-\s&+]*(?:chs|cht|zh)`)
	traditionalNamePattern = regexp.MustCompile(`(?i)繁体|繁中|cht|big5|zh[-_.\s]?hant|\btc\b`)
	simplifiedNamePattern  = regexp.MustCompile(`(?i)简体|简中|chs|gb|zh[-_.\s]?hans|\bsc\b`)
	englishNamePattern     = regexp.MustCompile(`(?i)\b(eng|english|en)\b|英语|英文`)
	chineseNamePattern     = regexp.MustCompile(`中文|国语|粤语|(?i)\b(chi|chinese|zh|chs|cht)\b`)
	japaneseNamePattern    = regexp.MustCompile(`(?i)\b(jpn|japanese|jp)\b|日语|日文`)
	koreanNamePattern      = regexp.MustCompile(`(?i)\b(kor|korean|kr)\b|韩语|韩文`)
	assDialogueLinePattern = regexp.MustCompile(`(?i)^dialogue\s*:`)
	assOverridePattern     = regexp.MustCompile(`\{[^}]*\}`)
	htmlTagStripPattern    = regexp.MustCompile(`(?s)<[^>]+>`)
	latinWordPattern       = regexp.MustCompile(`[A-Za-z]{2,}`)
)

// DetectLanguageOptions controls label inference for install/upload paths.
type DetectLanguageOptions struct {
	// ExplicitLabel wins when non-empty after normalization.
	ExplicitLabel string
	// NameHints are free-text sources (filename, SubHD title, langs tags, etc.).
	NameHints []string
	// Content is raw subtitle bytes for light sampling (optional).
	Content []byte
	// Format is file extension with or without dot (srt/ass/vtt); optional when Content set.
	Format string
	// DefaultLabel used when nothing is detected (SubHD corpus default: zh).
	DefaultLabel string
}

// DetectSubtitleLanguageLabel infers a canonical filename language label.
// Priority: explicit label → name/metadata hints → content sample → default.
// Content sampling can upgrade mono labels to bilingual when dual-track text is clear.
func DetectSubtitleLanguageLabel(opts DetectLanguageOptions) string {
	fromContent := detectLanguageFromContent(opts.Content, opts.Format)

	if explicit := NormalizeLanguageLabel(opts.ExplicitLabel); explicit != "" {
		if IsBilingualLanguage(fromContent) && !IsBilingualLanguage(explicit) {
			return fromContent
		}
		return explicit
	}

	if fromName := detectLanguageFromNameHints(opts.NameHints...); fromName != "" {
		if IsBilingualLanguage(fromContent) && !IsBilingualLanguage(fromName) {
			return fromContent
		}
		// Prefer traditional when content strongly suggests it and name only said "zh".
		if fromName == "zh" && (fromContent == "zh-hant" || fromContent == "zh-hant&en") {
			return fromContent
		}
		return fromName
	}

	if fromContent != "" {
		return fromContent
	}

	def := strings.TrimSpace(opts.DefaultLabel)
	if def == "" {
		def = "zh"
	}
	if mapped := NormalizeLanguageLabel(def); mapped != "" {
		return mapped
	}
	return "zh"
}

// DetectLanguageType classifies free-text for batch preference filters.
// Returns: bilingual | simplified | traditional | english | japanese | korean | unknown
func DetectLanguageType(name string) string {
	text := strings.ToLower(name)
	if bilingualNamePattern.MatchString(text) || strings.Contains(name, "双语") || strings.Contains(name, "中英") {
		return "bilingual"
	}
	if simplifiedNamePattern.MatchString(text) || strings.Contains(name, "简体") || strings.Contains(name, "简中") {
		return "simplified"
	}
	if traditionalNamePattern.MatchString(text) || strings.Contains(name, "繁体") || strings.Contains(name, "繁中") {
		return "traditional"
	}
	if englishNamePattern.MatchString(text) || strings.Contains(name, "英语") || strings.Contains(name, "英文") {
		return "english"
	}
	if japaneseNamePattern.MatchString(text) || strings.Contains(name, "日语") || strings.Contains(name, "日文") {
		return "japanese"
	}
	if koreanNamePattern.MatchString(text) || strings.Contains(name, "韩语") || strings.Contains(name, "韩文") {
		return "korean"
	}
	return "unknown"
}

func detectLanguageFromNameHints(parts ...string) string {
	raw := strings.Join(parts, " ")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	lower := strings.ToLower(raw)

	hasBilingual := bilingualNamePattern.MatchString(lower) || strings.Contains(raw, "双语") || strings.Contains(raw, "中英")
	hasTraditional := traditionalNamePattern.MatchString(lower) || strings.Contains(raw, "繁")
	hasSimplified := simplifiedNamePattern.MatchString(lower) || strings.Contains(raw, "简")
	hasZh := hasSimplified || hasTraditional || chineseNamePattern.MatchString(lower) ||
		strings.Contains(raw, "中文") || strings.Contains(raw, "国语") || strings.Contains(raw, "粤语") ||
		hasLangToken(lower, "chs", "cht", "zh", "zh-cn", "zh-tw", "zh_cn", "zh_tw", "zh-hans", "zh-hant",
			"chi", "chinese", "sc", "tc", "gb", "big5", "cn", "tw", "hk")
	hasEn := hasEnglishSubtitleHint(lower, raw)

	if hasBilingual || (hasZh && hasEn) {
		if hasTraditional && !hasSimplified {
			return "zh-hant&en"
		}
		return "zh&en"
	}
	if hasZh {
		if hasTraditional && !hasSimplified {
			return "zh-hant"
		}
		return "zh"
	}
	if hasEn {
		return "en"
	}
	if DetectLanguageType(raw) == "japanese" {
		return "ja"
	}
	if DetectLanguageType(raw) == "korean" {
		return "ko"
	}
	return ""
}

func hasEnglishSubtitleHint(lower, raw string) bool {
	if strings.Contains(raw, "英") {
		return true
	}
	return hasLangToken(lower, "eng", "en", "english")
}

func hasLangToken(lower string, tokens ...string) bool {
	fields := strings.FieldsFunc(lower, func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '-' && r != '_'
	})
	seen := make(map[string]struct{}, len(fields))
	for _, f := range fields {
		f = strings.Trim(f, "-_")
		if f == "" {
			continue
		}
		seen[f] = struct{}{}
	}
	for _, token := range tokens {
		token = strings.ToLower(token)
		if _, ok := seen[token]; ok {
			return true
		}
		if strings.Contains(token, "-") || strings.Contains(token, "_") {
			if _, ok := seen[strings.ReplaceAll(token, "_", "-")]; ok {
				return true
			}
		}
	}
	return false
}

// detectLanguageFromContent samples dialogue text for zh / en / bilingual.
func detectLanguageFromContent(data []byte, format string) string {
	if len(data) == 0 {
		return ""
	}
	text, _, err := DecodeSubtitleBytes(data, "auto")
	if err != nil || strings.TrimSpace(text) == "" {
		return ""
	}
	ext := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(format), "."))
	if ext == "" {
		// Best-effort sniff from content markers.
		lower := strings.ToLower(text)
		switch {
		case strings.Contains(lower, "[events]") || strings.Contains(lower, "dialogue:"):
			ext = "ass"
		case strings.Contains(text, "-->"):
			ext = "srt"
		default:
			ext = "srt"
		}
	}

	lines := sampleDialogueLines(text, ext, contentSampleMaxCues)
	if len(lines) == 0 {
		return ""
	}

	var hanRunes, latinWords, dualLineCues, mixedLineCues int
	var traditionalHints, simplifiedHints int
	for _, line := range lines {
		cleaned := cleanDialogueText(line)
		if cleaned == "" {
			continue
		}
		// Multi-line cue: Chinese line + English line.
		parts := strings.Split(cleaned, "\n")
		if len(parts) >= 2 {
			var lineHasHan, lineHasLatin bool
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p == "" {
					continue
				}
				if containsHan(p) {
					lineHasHan = true
					hanRunes += countHan(p)
					traditionalHints += countTraditionalHints(p)
					simplifiedHints += countSimplifiedHints(p)
				}
				if latinWordPattern.MatchString(p) {
					lineHasLatin = true
					latinWords += len(latinWordPattern.FindAllString(p, -1))
				}
			}
			if lineHasHan && lineHasLatin {
				dualLineCues++
			}
			continue
		}

		hasHan := containsHan(cleaned)
		hasLatin := latinWordPattern.MatchString(cleaned)
		if hasHan {
			hanRunes += countHan(cleaned)
			traditionalHints += countTraditionalHints(cleaned)
			simplifiedHints += countSimplifiedHints(cleaned)
		}
		if hasLatin {
			latinWords += len(latinWordPattern.FindAllString(cleaned, -1))
		}
		if hasHan && hasLatin {
			mixedLineCues++
		}
	}

	bilingual := dualLineCues >= 2 || mixedLineCues >= 3 || (hanRunes >= 8 && latinWords >= 8 && (dualLineCues+mixedLineCues) >= 1)
	hasZh := hanRunes >= 4
	hasEn := latinWords >= 6

	if bilingual || (hasZh && hasEn && (dualLineCues+mixedLineCues) > 0) {
		if traditionalHints > simplifiedHints*2 && traditionalHints >= 3 {
			return "zh-hant&en"
		}
		return "zh&en"
	}
	if hasZh && !hasEn {
		if traditionalHints > simplifiedHints*2 && traditionalHints >= 3 {
			return "zh-hant"
		}
		return "zh"
	}
	if hasEn && !hasZh {
		return "en"
	}
	return ""
}

func sampleDialogueLines(text, ext string, maxCues int) []string {
	if maxCues < 1 {
		maxCues = contentSampleMaxCues
	}
	switch ext {
	case "ass", "ssa":
		return sampleASSDialogues(text, maxCues)
	case "vtt":
		return sampleSRTLikeDialogues(text, maxCues, true)
	default:
		return sampleSRTLikeDialogues(text, maxCues, false)
	}
}

func sampleASSDialogues(text string, maxCues int) []string {
	out := make([]string, 0, maxCues)
	for _, line := range strings.Split(normalizeNewlines(text), "\n") {
		trimmed := strings.TrimSpace(line)
		if !assDialogueLinePattern.MatchString(trimmed) {
			continue
		}
		// Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
		// Text is the 10th comma-separated field (index 9), but text may contain commas.
		parts := strings.SplitN(trimmed, ",", 10)
		if len(parts) < 10 {
			continue
		}
		body := strings.ReplaceAll(parts[9], "\\N", "\n")
		body = strings.ReplaceAll(body, "\\n", "\n")
		body = assOverridePattern.ReplaceAllString(body, "")
		body = strings.TrimSpace(body)
		if body == "" {
			continue
		}
		out = append(out, body)
		if len(out) >= maxCues {
			break
		}
	}
	return out
}

func sampleSRTLikeDialogues(text string, maxCues int, isVTT bool) []string {
	out := make([]string, 0, maxCues)
	lines := strings.Split(normalizeNewlines(strings.TrimPrefix(text, "\ufeff")), "\n")
	i := 0
	if isVTT {
		for i < len(lines) && (strings.TrimSpace(lines[i]) == "" || strings.HasPrefix(strings.ToUpper(strings.TrimSpace(lines[i])), "WEBVTT")) {
			i++
		}
	}
	for i < len(lines) && len(out) < maxCues {
		for i < len(lines) && strings.TrimSpace(lines[i]) == "" {
			i++
		}
		if i >= len(lines) {
			break
		}
		// Skip cue id / NOTE / STYLE blocks lightly.
		if isVTT {
			upper := strings.ToUpper(strings.TrimSpace(lines[i]))
			if strings.HasPrefix(upper, "NOTE") || strings.HasPrefix(upper, "STYLE") || strings.HasPrefix(upper, "REGION") {
				for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
					i++
				}
				continue
			}
		}
		timeLine := lines[i]
		if !strings.Contains(timeLine, "-->") && i+1 < len(lines) && strings.Contains(lines[i+1], "-->") {
			i++
			timeLine = lines[i]
		}
		if !strings.Contains(timeLine, "-->") {
			i++
			continue
		}
		i++
		var body []string
		for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
			body = append(body, lines[i])
			i++
		}
		if len(body) > 0 {
			out = append(out, strings.Join(body, "\n"))
		}
	}
	return out
}

func cleanDialogueText(line string) string {
	line = htmlTagStripPattern.ReplaceAllString(line, "")
	line = strings.ReplaceAll(line, "&nbsp;", " ")
	return strings.TrimSpace(line)
}

func containsHan(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func countHan(s string) int {
	n := 0
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			n++
		}
	}
	return n
}

// Rough simplified vs traditional heuristics (common divergent characters).
var traditionalOnlyRunes = map[rune]struct{}{
	'國': {}, '語': {}, '對': {}, '這': {}, '來': {}, '時': {}, '會': {}, '過': {},
	'還': {}, '麼': {}, '們': {}, '個': {}, '說': {}, '為': {}, '東': {},
	'與': {}, '無': {}, '開': {}, '關': {}, '門': {}, '問': {}, '題': {}, '見': {},
	'覺': {}, '聽': {}, '讓': {}, '從': {}, '應': {}, '該': {}, '經': {}, '現': {},
	'發': {}, '電': {}, '話': {}, '愛': {}, '親': {}, '兒': {}, '孫': {}, '學': {},
	'習': {}, '書': {}, '讀': {}, '寫': {}, '長': {}, '馬': {}, '鳥': {}, '魚': {},
	'龍': {}, '萬': {}, '億': {}, '兩': {}, '並': {}, '業': {}, '產': {}, '區': {},
}

var simplifiedOnlyRunes = map[rune]struct{}{
	'国': {}, '语': {}, '对': {}, '这': {}, '来': {}, '时': {}, '会': {}, '过': {},
	'还': {}, '么': {}, '们': {}, '个': {}, '说': {}, '为': {}, '东': {}, '与': {},
	'无': {}, '开': {}, '关': {}, '门': {}, '问': {}, '题': {}, '见': {}, '觉': {},
	'听': {}, '让': {}, '从': {}, '应': {}, '该': {}, '经': {}, '现': {}, '发': {},
	'电': {}, '话': {}, '爱': {}, '亲': {}, '儿': {}, '孙': {}, '学': {}, '习': {},
	'书': {}, '读': {}, '写': {}, '长': {}, '马': {}, '鸟': {}, '鱼': {}, '龙': {},
	'万': {}, '亿': {}, '两': {}, '并': {}, '业': {}, '产': {}, '区': {},
}

func countTraditionalHints(s string) int {
	n := 0
	for _, r := range s {
		if _, ok := traditionalOnlyRunes[r]; ok {
			n++
		}
	}
	return n
}

func countSimplifiedHints(s string) int {
	n := 0
	for _, r := range s {
		if _, ok := simplifiedOnlyRunes[r]; ok {
			n++
		}
	}
	return n
}

// LabelFromFileName is a convenience for basename-only inference.
func LabelFromFileName(name string) string {
	base := filepath.Base(name)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	return DetectSubtitleLanguageLabel(DetectLanguageOptions{
		NameHints:    []string{base, name},
		DefaultLabel: "",
	})
}
