package subhd

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode/v2"
)

const maxSubtitleEntryBytes = 32 << 20

var allowedSubtitleExts = map[string]struct{}{
	".srt": {},
	".ass": {},
	".ssa": {},
	".vtt": {},
	".sub": {},
}

func isAllowedSubtitleExt(ext string) bool {
	_, ok := allowedSubtitleExts[strings.ToLower(ext)]
	return ok
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
	// RAR 1.5+ signature "Rar!"
	return len(data) >= 4 && data[0] == 'R' && data[1] == 'a' && data[2] == 'r' && data[3] == '!'
}

func isUnsupportedArchive(data []byte, ext string) bool {
	lower := strings.ToLower(ext)
	switch lower {
	case ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz2", ".txz":
		return true
	}
	// gzip magic
	if len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b {
		return true
	}
	// xz magic
	if len(data) >= 6 && bytes.Equal(data[:6], []byte{0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00}) {
		return true
	}
	// bzip2 magic "BZh"
	if len(data) >= 3 && data[0] == 'B' && data[1] == 'Z' && data[2] == 'h' {
		return true
	}
	// ustar tar at offset 257
	if len(data) >= 262 && string(data[257:262]) == "ustar" {
		return true
	}
	return false
}

type archiveCandidate struct {
	name string
	size uint64
	open func() (io.ReadCloser, error)
}

func pickArchiveSubtitle(candidates []archiveCandidate, preferredEntry string) (string, []byte, error) {
	if len(candidates) == 0 {
		return "", nil, ErrNoSubtitleInArchive
	}

	preferred := strings.TrimSpace(preferredEntry)
	var chosen archiveCandidate
	if preferred != "" {
		for _, c := range candidates {
			if c.name == preferred || path.Base(strings.ReplaceAll(c.name, "\\", "/")) == preferred {
				chosen = c
				break
			}
		}
		if chosen.open == nil {
			return "", nil, fmt.Errorf("%w: entry %q not found", ErrProvider, preferred)
		}
	} else if len(candidates) == 1 {
		chosen = candidates[0]
	} else {
		bestScore := -1
		var best archiveCandidate
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
			names := make([]string, 0, len(candidates))
			for _, c := range candidates {
				names = append(names, c.name)
			}
			return "", nil, fmt.Errorf("%w: %s", ErrMultipleEntries, strings.Join(names, ", "))
		}
		chosen = best
	}

	rc, err := chosen.open()
	if err != nil {
		return "", nil, wrapProvider(err)
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, maxSubtitleEntryBytes))
	if err != nil {
		return "", nil, wrapProvider(err)
	}
	base := path.Base(strings.ReplaceAll(chosen.name, "\\", "/"))
	return base, raw, nil
}

func considerSubtitleEntry(name string, size uint64, open func() (io.ReadCloser, error), out *[]archiveCandidate) {
	if open == nil {
		return
	}
	normalized := strings.ReplaceAll(name, "\\", "/")
	base := path.Base(normalized)
	if base == "" || base == "." || base == ".." {
		return
	}
	if strings.HasPrefix(base, ".") {
		return
	}
	ext := strings.ToLower(path.Ext(base))
	if !isAllowedSubtitleExt(ext) {
		return
	}
	*out = append(*out, archiveCandidate{name: name, size: size, open: open})
}

func extractZipSubtitle(data []byte, preferredEntry string) (string, []byte, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", nil, fmt.Errorf("%w: invalid zip: %v", ErrProvider, err)
	}

	var candidates []archiveCandidate
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		file := f
		considerSubtitleEntry(file.Name, file.UncompressedSize64, func() (io.ReadCloser, error) {
			return file.Open()
		}, &candidates)
	}
	return pickArchiveSubtitle(candidates, preferredEntry)
}

func extractSevenZipSubtitle(data []byte, preferredEntry string) (string, []byte, error) {
	r, err := sevenzip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", nil, fmt.Errorf("%w: invalid 7z: %v", ErrProvider, err)
	}

	var candidates []archiveCandidate
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		file := f
		considerSubtitleEntry(file.Name, file.UncompressedSize, func() (io.ReadCloser, error) {
			return file.Open()
		}, &candidates)
	}
	return pickArchiveSubtitle(candidates, preferredEntry)
}

func extractRarSubtitle(data []byte, preferredEntry string) (string, []byte, error) {
	rr, err := rardecode.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", nil, fmt.Errorf("%w: invalid rar: %v", ErrProvider, err)
	}

	// RAR is sequential (esp. solid). Materialize installable entries first.
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
			return "", nil, wrapProvider(err)
		}
		if hdr.IsDir {
			continue
		}
		base := path.Base(strings.ReplaceAll(hdr.Name, "\\", "/"))
		if strings.HasPrefix(base, ".") {
			continue
		}
		ext := strings.ToLower(path.Ext(base))
		if !isAllowedSubtitleExt(ext) {
			_, _ = io.Copy(io.Discard, io.LimitReader(rr, maxSubtitleEntryBytes+1))
			continue
		}
		raw, err := io.ReadAll(io.LimitReader(rr, maxSubtitleEntryBytes))
		if err != nil {
			return "", nil, wrapProvider(err)
		}
		sz := uint64(len(raw))
		if hdr.UnPackedSize > 0 {
			sz = uint64(hdr.UnPackedSize)
		}
		entries = append(entries, materialised{name: hdr.Name, size: sz, data: raw})
	}

	var candidates []archiveCandidate
	for i := range entries {
		e := entries[i]
		payload := e.data
		considerSubtitleEntry(e.name, e.size, func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(payload)), nil
		}, &candidates)
	}
	return pickArchiveSubtitle(candidates, preferredEntry)
}

func scoreSubtitleName(name string) int {
	lower := strings.ToLower(name)
	score := 0
	for _, key := range []string{"简体", "简中", "chs", "zh-cn", "zh_cn", "gb", "chi", "chinese", "双语", "cht", "zh"} {
		if strings.Contains(lower, key) || strings.Contains(name, key) {
			score += 2
		}
	}
	if strings.Contains(lower, "eng") || strings.Contains(name, "英语") {
		score++
	}
	return score
}
