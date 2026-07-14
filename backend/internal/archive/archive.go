package archive

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode/v2"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const MaxSubtitleEntryBytes = 32 << 20

var (
	ErrUnsupported        = errors.New("unsupported archive format")
	ErrMultipleEntries    = errors.New("archive contains multiple subtitle files")
	ErrNoSubtitle         = errors.New("archive contains no installable subtitle")
	ErrNotArchive         = errors.New("not an archive")
	ErrEntryNotFound      = errors.New("archive entry not found")
	ErrInvalidArchive     = errors.New("invalid archive")
	ErrReadFailed         = errors.New("failed to read archive entry")
)

var allowedSubtitleExts = map[string]struct{}{
	".srt": {},
	".ass": {},
	".ssa": {},
	".vtt": {},
	".sub": {},
}

// Entry is a subtitle file inside an archive (metadata only).
type Entry struct {
	Path     string `json:"path"`
	FileName string `json:"fileName"`
	Size     int64  `json:"size"`
}

// MultipleEntriesError carries the candidate list when auto-pick fails.
type MultipleEntriesError struct {
	Entries []Entry
}

func (e *MultipleEntriesError) Error() string {
	if e == nil {
		return ErrMultipleEntries.Error()
	}
	names := make([]string, 0, len(e.Entries))
	for _, ent := range e.Entries {
		names = append(names, ent.Path)
	}
	if len(names) == 0 {
		return ErrMultipleEntries.Error()
	}
	return fmt.Sprintf("%s: %s", ErrMultipleEntries.Error(), strings.Join(names, ", "))
}

func (e *MultipleEntriesError) Unwrap() error {
	return ErrMultipleEntries
}

func IsAllowedSubtitleExt(ext string) bool {
	_, ok := allowedSubtitleExts[strings.ToLower(ext)]
	return ok
}

func IsArchive(data []byte, name string) bool {
	ext := strings.ToLower(path.Ext(name))
	return isZip(data, ext) || isSevenZip(data, ext) || isRar(data, ext)
}

func isZip(data []byte, ext string) bool {
	if strings.EqualFold(ext, ".zip") {
		return true
	}
	return len(data) >= 4 && data[0] == 'P' && data[1] == 'K' && data[2] == 3 && data[3] == 4
}

func isSevenZip(data []byte, ext string) bool {
	if strings.EqualFold(ext, ".7z") {
		return true
	}
	return len(data) >= 6 && bytes.Equal(data[:6], []byte{0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C})
}

func isRar(data []byte, ext string) bool {
	if strings.EqualFold(ext, ".rar") {
		return true
	}
	return len(data) >= 4 && data[0] == 'R' && data[1] == 'a' && data[2] == 'r' && data[3] == '!'
}

func IsUnsupportedArchive(data []byte, name string) bool {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2", ".txz":
		return true
	}
	if len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b {
		return true
	}
	if len(data) >= 6 && bytes.Equal(data[:6], []byte{0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00}) {
		return true
	}
	if len(data) >= 3 && data[0] == 'B' && data[1] == 'Z' && data[2] == 'h' {
		return true
	}
	if len(data) >= 262 && string(data[257:262]) == "ustar" {
		return true
	}
	return false
}

type candidate struct {
	name string
	size uint64
	open func() (io.ReadCloser, error)
}

func normalizeEntryPath(name string) string {
	return strings.TrimPrefix(strings.ReplaceAll(name, "\\", "/"), "/")
}

// decodeZipEntryName converts ZIP local-header names to UTF-8.
// Chinese subtitle packs often store GBK/GB18030 names without the UTF-8 flag;
// Go keeps those as raw bytes (invalid UTF-8), which JSON later corrupts to U+FFFD
// so prepare/list keys no longer match install lookups.
func decodeZipEntryName(name string, nonUTF8 bool) string {
	_ = nonUTF8
	if name == "" {
		return name
	}
	// Valid UTF-8 is kept even when NonUTF8 is set (writers often omit the UTF-8 flag).
	if utf8.ValidString(name) {
		return name
	}
	raw := []byte(name)
	if decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(raw); err == nil {
		s := string(decoded)
		if utf8.ValidString(s) && s != "" {
			return s
		}
	}
	return strings.ToValidUTF8(name, "\uFFFD")
}

func entryFileName(name string) string {
	return path.Base(normalizeEntryPath(name))
}

func matchPreferred(name, preferred string) bool {
	preferred = strings.TrimSpace(preferred)
	if preferred == "" {
		return false
	}
	norm := normalizeEntryPath(name)
	if norm == preferred || name == preferred {
		return true
	}
	return entryFileName(name) == preferred || entryFileName(name) == path.Base(preferred)
}

func scoreSubtitleName(name string) int {
	lower := strings.ToLower(name)
	score := 0
	// Bilingual first (highest weight).
	for _, key := range []string{"双语", "bilingual", "中英", "简英", "繁英", "chs&eng", "cht&eng", "zh&en", "en&zh"} {
		if strings.Contains(lower, key) || strings.Contains(name, key) {
			score += 8
		}
	}
	for _, key := range []string{"简体", "简中", "chs", "zh-cn", "zh_cn", "gb", "chi", "chinese", "cht", "zh"} {
		if strings.Contains(lower, key) || strings.Contains(name, key) {
			score += 2
		}
	}
	if strings.Contains(lower, "eng") || strings.Contains(name, "英语") {
		score++
	}
	return score
}

func considerSubtitleEntry(name string, size uint64, open func() (io.ReadCloser, error), out *[]candidate) {
	if open == nil {
		return
	}
	normalized := normalizeEntryPath(name)
	base := path.Base(normalized)
	if base == "" || base == "." || base == ".." {
		return
	}
	if strings.HasPrefix(base, ".") {
		return
	}
	if strings.Contains(normalized, "..") {
		return
	}
	ext := strings.ToLower(path.Ext(base))
	if !IsAllowedSubtitleExt(ext) {
		return
	}
	*out = append(*out, candidate{name: normalized, size: size, open: open})
}

func candidatesToEntries(candidates []candidate) []Entry {
	out := make([]Entry, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, Entry{
			Path:     c.name,
			FileName: entryFileName(c.name),
			Size:     int64(c.size),
		})
	}
	return out
}

func pickSubtitle(candidates []candidate, preferredEntry string) (string, []byte, error) {
	if len(candidates) == 0 {
		return "", nil, ErrNoSubtitle
	}

	preferred := strings.TrimSpace(preferredEntry)
	var chosen candidate
	if preferred != "" {
		for _, c := range candidates {
			if matchPreferred(c.name, preferred) {
				chosen = c
				break
			}
		}
		if chosen.open == nil {
			return "", nil, fmt.Errorf("%w: %q", ErrEntryNotFound, preferred)
		}
	} else if len(candidates) == 1 {
		chosen = candidates[0]
	} else {
		bestScore := -1
		var best candidate
		var bestSize uint64
		for _, c := range candidates {
			score := scoreSubtitleName(c.name)
			if score > bestScore || (score == bestScore && c.size > bestSize) {
				bestScore = score
				bestSize = c.size
				best = c
			}
		}
		if bestScore == 0 && len(candidates) > 1 {
			return "", nil, &MultipleEntriesError{Entries: candidatesToEntries(candidates)}
		}
		chosen = best
	}

	rc, err := chosen.open()
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrReadFailed, err)
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, MaxSubtitleEntryBytes))
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrReadFailed, err)
	}
	return entryFileName(chosen.name), raw, nil
}

func collectZip(data []byte) ([]candidate, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid zip: %v", ErrInvalidArchive, err)
	}
	var candidates []candidate
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		file := f
		entryName := decodeZipEntryName(file.Name, file.NonUTF8)
		considerSubtitleEntry(entryName, file.UncompressedSize64, func() (io.ReadCloser, error) {
			return file.Open()
		}, &candidates)
	}
	return candidates, nil
}

func collectSevenZip(data []byte) ([]candidate, error) {
	r, err := sevenzip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid 7z: %v", ErrInvalidArchive, err)
	}
	var candidates []candidate
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		file := f
		considerSubtitleEntry(file.Name, file.UncompressedSize, func() (io.ReadCloser, error) {
			return file.Open()
		}, &candidates)
	}
	return candidates, nil
}

func collectRar(data []byte) ([]candidate, error) {
	rr, err := rardecode.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid rar: %v", ErrInvalidArchive, err)
	}

	type materialised struct {
		name string
		size uint64
		data []byte
	}
	var entries []materialised
	for {
		hdr, err := rr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrReadFailed, err)
		}
		if hdr.IsDir {
			continue
		}
		base := entryFileName(hdr.Name)
		if strings.HasPrefix(base, ".") {
			continue
		}
		ext := strings.ToLower(path.Ext(base))
		if !IsAllowedSubtitleExt(ext) {
			_, _ = io.Copy(io.Discard, io.LimitReader(rr, MaxSubtitleEntryBytes+1))
			continue
		}
		raw, err := io.ReadAll(io.LimitReader(rr, MaxSubtitleEntryBytes))
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrReadFailed, err)
		}
		sz := uint64(len(raw))
		if hdr.UnPackedSize > 0 {
			sz = uint64(hdr.UnPackedSize)
		}
		entries = append(entries, materialised{name: hdr.Name, size: sz, data: raw})
	}

	var candidates []candidate
	for i := range entries {
		e := entries[i]
		payload := e.data
		considerSubtitleEntry(e.name, e.size, func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(payload)), nil
		}, &candidates)
	}
	return candidates, nil
}

func collectCandidates(data []byte, name string) ([]candidate, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("%w: empty payload", ErrInvalidArchive)
	}
	ext := strings.ToLower(path.Ext(name))
	switch {
	case isZip(data, ext):
		return collectZip(data)
	case isSevenZip(data, ext):
		return collectSevenZip(data)
	case isRar(data, ext):
		return collectRar(data)
	case IsUnsupportedArchive(data, name):
		if ext == "" {
			ext = "archive"
		}
		return nil, fmt.Errorf("%w: %s", ErrUnsupported, ext)
	default:
		return nil, ErrNotArchive
	}
}

// ListSubtitleEntries returns metadata for installable subtitle files in an archive.
func ListSubtitleEntries(data []byte, name string) ([]Entry, error) {
	candidates, err := collectCandidates(data, name)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, ErrNoSubtitle
	}
	return candidatesToEntries(candidates), nil
}

// ExtractSubtitle extracts one subtitle from an archive.
// If preferredEntry is empty, auto-picks (single entry or scored name).
func ExtractSubtitle(data []byte, name string, preferredEntry string) (fileName string, content []byte, err error) {
	candidates, err := collectCandidates(data, name)
	if err != nil {
		return "", nil, err
	}
	return pickSubtitle(candidates, preferredEntry)
}

// ExtractAllSubtitles extracts every installable subtitle entry.
func ExtractAllSubtitles(data []byte, name string) (map[string][]byte, error) {
	candidates, err := collectCandidates(data, name)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, ErrNoSubtitle
	}
	out := make(map[string][]byte, len(candidates))
	for _, c := range candidates {
		rc, err := c.open()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrReadFailed, err)
		}
		raw, err := io.ReadAll(io.LimitReader(rc, MaxSubtitleEntryBytes))
		_ = rc.Close()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrReadFailed, err)
		}
		out[c.name] = raw
	}
	return out, nil
}
