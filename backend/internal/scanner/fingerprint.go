package scanner

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
)

const fingerprintVersion = "fp1"

// ComputeMediaFingerprint builds a stable disk fingerprint for video + NFO +
// sidecar subtitles (no content reads). posterPath may be empty.
func ComputeMediaFingerprint(videoPath string, mediaType string, posterPath string) (fp string, size int64, modTime time.Time, err error) {
	absPath, err := filepath.Abs(videoPath)
	if err != nil {
		return "", 0, time.Time{}, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return "", 0, time.Time{}, err
	}
	if info.IsDir() {
		return "", 0, time.Time{}, fmt.Errorf("video path is a directory: %s", absPath)
	}

	var b strings.Builder
	b.Grow(256)
	b.WriteString(fingerprintVersion)
	b.WriteString("|v:")
	b.WriteString(strconv.FormatInt(info.Size(), 10))
	b.WriteString(":")
	b.WriteString(strconv.FormatInt(info.ModTime().UTC().UnixNano(), 10))

	dir := filepath.Dir(absPath)
	base := strings.TrimSuffix(filepath.Base(absPath), filepath.Ext(absPath))
	for _, nfoPath := range nfoCandidatePaths(dir, base, mediaType) {
		appendFileFingerprint(&b, "n", nfoPath)
	}

	subEntries, subErr := listSubtitleFingerprintEntries(absPath)
	if subErr == nil {
		sort.Slice(subEntries, func(i, j int) bool {
			return subEntries[i].path < subEntries[j].path
		})
		for _, entry := range subEntries {
			b.WriteString("|s:")
			b.WriteString(entry.path)
			b.WriteString(":")
			b.WriteString(strconv.FormatInt(entry.size, 10))
			b.WriteString(":")
			b.WriteString(strconv.FormatInt(entry.modNano, 10))
		}
	}

	poster := strings.TrimSpace(posterPath)
	if poster == "" {
		b.WriteString("|p:")
	} else {
		appendFileFingerprint(&b, "p", poster)
	}

	return b.String(), info.Size(), info.ModTime().UTC(), nil
}

func hasMetadataSidecar(dir string, base string, mediaType string) bool {
	for _, nfoPath := range nfoCandidatePaths(dir, base, mediaType) {
		info, err := os.Stat(nfoPath)
		if err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func nfoCandidatePaths(dir string, base string, mediaType string) []string {
	out := []string{
		filepath.Join(dir, base+".nfo"),
		filepath.Join(dir, "movie.nfo"),
	}
	if mediaType == domain.MediaTypeTV {
		currentDir := dir
		for i := 0; i < 3; i++ {
			out = append(out, filepath.Join(currentDir, "tvshow.nfo"))
			parent := filepath.Dir(currentDir)
			if parent == currentDir {
				break
			}
			currentDir = parent
		}
	}
	return out
}

type fingerprintEntry struct {
	path    string
	size    int64
	modNano int64
}

func listSubtitleFingerprintEntries(videoAbs string) ([]fingerprintEntry, error) {
	dir := filepath.Dir(videoAbs)
	videoName := filepath.Base(videoAbs)
	videoBase := strings.TrimSuffix(videoName, filepath.Ext(videoName))

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	out := make([]fingerprintEntry, 0, 8)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if !isSubtitleExt(ext) {
			continue
		}
		nameBase := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if nameBase != videoBase && !strings.HasPrefix(nameBase, videoBase+".") &&
			!strings.HasPrefix(nameBase, videoBase+"_") && !strings.HasPrefix(nameBase, videoBase+"-") {
			continue
		}
		subPath := filepath.Join(dir, entry.Name())
		info, statErr := entry.Info()
		if statErr != nil {
			continue
		}
		out = append(out, fingerprintEntry{
			path:    strings.ToLower(filepath.Clean(subPath)),
			size:    info.Size(),
			modNano: info.ModTime().UTC().UnixNano(),
		})
	}
	return out, nil
}

func appendFileFingerprint(b *strings.Builder, kind string, path string) {
	clean := strings.ToLower(filepath.Clean(strings.TrimSpace(path)))
	if clean == "" || clean == "." {
		b.WriteString("|")
		b.WriteString(kind)
		b.WriteString(":")
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		b.WriteString("|")
		b.WriteString(kind)
		b.WriteString(":")
		b.WriteString(clean)
		return
	}
	b.WriteString("|")
	b.WriteString(kind)
	b.WriteString(":")
	b.WriteString(clean)
	b.WriteString(":")
	b.WriteString(strconv.FormatInt(info.Size(), 10))
	b.WriteString(":")
	b.WriteString(strconv.FormatInt(info.ModTime().UTC().UnixNano(), 10))
}
