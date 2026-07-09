package subhd

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path"
	"strings"
)

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

func isUnsupportedArchive(data []byte, ext string) bool {
	lower := strings.ToLower(ext)
	switch lower {
	case ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz":
		return true
	}
	// 7z magic
	if len(data) >= 6 && bytes.Equal(data[:6], []byte{0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C}) {
		return true
	}
	// rar magic
	if len(data) >= 4 && data[0] == 'R' && data[1] == 'a' && data[2] == 'r' && data[3] == '!' {
		return true
	}
	return false
}

func extractZipSubtitle(data []byte, preferredEntry string) (string, []byte, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", nil, fmt.Errorf("%w: invalid zip: %v", ErrProvider, err)
	}

	type entry struct {
		name string
		file *zip.File
	}
	var candidates []entry
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		base := path.Base(strings.ReplaceAll(f.Name, "\\", "/"))
		if strings.HasPrefix(base, ".") {
			continue
		}
		ext := strings.ToLower(path.Ext(base))
		if !isAllowedSubtitleExt(ext) {
			continue
		}
		candidates = append(candidates, entry{name: f.Name, file: f})
	}
	if len(candidates) == 0 {
		return "", nil, ErrNoSubtitleInArchive
	}

	preferred := strings.TrimSpace(preferredEntry)
	var chosen entry
	if preferred != "" {
		for _, c := range candidates {
			if c.name == preferred || path.Base(c.name) == preferred {
				chosen = c
				break
			}
		}
		if chosen.file == nil {
			return "", nil, fmt.Errorf("%w: entry %q not found", ErrProvider, preferred)
		}
	} else if len(candidates) == 1 {
		chosen = candidates[0]
	} else {
		// heuristic: prefer names with 简/chs/zh; else largest
		bestScore := -1
		var best entry
		var bestSize uint64
		for _, c := range candidates {
			score := scoreSubtitleName(c.name)
			sz := c.file.UncompressedSize64
			if score > bestScore || (score == bestScore && sz > bestSize) {
				bestScore = score
				bestSize = sz
				best = c
			}
		}
		// if still ambiguous equal scores and user didn't pick — still pick best heuristic
		// but if many entries, surface names when no clear zh preference and >1 with score 0
		if bestScore == 0 && len(candidates) > 1 {
			names := make([]string, 0, len(candidates))
			for _, c := range candidates {
				names = append(names, c.name)
			}
			return "", nil, fmt.Errorf("%w: %s", ErrMultipleEntries, strings.Join(names, ", "))
		}
		chosen = best
	}

	rc, err := chosen.file.Open()
	if err != nil {
		return "", nil, wrapProvider(err)
	}
	defer rc.Close()
	raw, err := io.ReadAll(io.LimitReader(rc, 32<<20))
	if err != nil {
		return "", nil, wrapProvider(err)
	}
	return path.Base(strings.ReplaceAll(chosen.name, "\\", "/")), raw, nil
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
