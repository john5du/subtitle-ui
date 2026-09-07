package idhash

import (
	"hash/fnv"
	"strings"
)

// FromString returns a stable uppercase hex FNV-64a of the lowercased input.
func FromString(s string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToLower(s)))
	return strings.ToUpper(formatUintHex(h.Sum64()))
}

func formatUintHex(v uint64) string {
	const alphabet = "0123456789ABCDEF"
	if v == 0 {
		return "0"
	}
	var out [16]byte
	pos := len(out)
	for v > 0 {
		pos--
		out[pos] = alphabet[v&0x0F]
		v >>= 4
	}
	return string(out[pos:])
}
