package textsort

import (
	"strings"
	"unicode"

	"github.com/mozillazg/go-pinyin"
)

var sortArgs = func() pinyin.Args {
	args := pinyin.NewArgs()
	args.Style = pinyin.Normal
	args.Fallback = func(r rune, _ pinyin.Args) []string {
		if unicode.IsSpace(r) {
			return []string{" "}
		}
		return []string{strings.ToLower(string(r))}
	}
	return args
}()

// SortKey returns a lowercase, pinyin-aware key for locale-friendly title sorting.
// Han characters become pinyin (first reading); other runes stay as lowercase text.
func SortKey(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	parts := pinyin.LazyPinyin(trimmed, sortArgs)
	if len(parts) == 0 {
		return strings.ToLower(trimmed)
	}
	return strings.Join(parts, "")
}

// Less reports whether a should sort before b using SortKey, with raw lowercase
// title as a stable secondary key.
func Less(a, b string) bool {
	keyA := SortKey(a)
	keyB := SortKey(b)
	if keyA != keyB {
		return keyA < keyB
	}
	return strings.ToLower(strings.TrimSpace(a)) < strings.ToLower(strings.TrimSpace(b))
}
