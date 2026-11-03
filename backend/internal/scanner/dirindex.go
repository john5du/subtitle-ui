package scanner

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DirIndex caches directory listings and stats for one scan. It is not safe
// for concurrent use. Subtitle listings and fingerprints share one ReadDir per
// directory, so a season folder is not re-listed for every episode.
// Successful results and os.ErrNotExist are cached. Other errors are not, so a
// transient NFS/SMB failure is retried instead of applied to every later file.
type DirIndex struct {
	readDir  func(string) ([]os.DirEntry, error)
	statPath func(string) (os.FileInfo, error)
	snaps    map[string]*dirSnap
	stats    map[string]cachedStat
}

type dirSnap struct {
	files map[string]os.FileInfo
	err   error
}

type cachedStat struct {
	info os.FileInfo
	err  error
}

type indexedFile struct {
	name string
	info os.FileInfo
}

func NewDirIndex() *DirIndex {
	return newDirIndex(os.ReadDir)
}

func newDirIndex(readDir func(string) ([]os.DirEntry, error)) *DirIndex {
	if readDir == nil {
		readDir = os.ReadDir
	}
	return &DirIndex{
		readDir: readDir,
		snaps:   make(map[string]*dirSnap),
		stats:   make(map[string]cachedStat),
	}
}

// ComputeMediaFingerprint matches ComputeMediaFingerprint, reusing cached listings.
func (d *DirIndex) ComputeMediaFingerprint(videoPath string, mediaType string, posterPath string) (fp string, size int64, modTime time.Time, err error) {
	if d == nil {
		d = NewDirIndex()
	}
	absPath, err := filepath.Abs(videoPath)
	if err != nil {
		return "", 0, time.Time{}, err
	}
	info, err := d.stat(absPath)
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
		d.appendFileFingerprint(&b, "n", nfoPath)
	}

	subEntries, subErr := d.subtitleFingerprintEntries(absPath)
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
		d.appendFileFingerprint(&b, "p", poster)
	}

	return b.String(), info.Size(), info.ModTime().UTC(), nil
}

func (d *DirIndex) hasMetadataSidecar(dir string, base string, mediaType string) bool {
	for _, nfoPath := range nfoCandidatePaths(dir, base, mediaType) {
		info, err := d.stat(nfoPath)
		if err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func (d *DirIndex) subtitleFiles(videoAbs string) ([]indexedFile, error) {
	dir := filepath.Dir(videoAbs)
	snap, err := d.snap(dir)
	if err != nil {
		return nil, err
	}
	videoBase := strings.TrimSuffix(filepath.Base(videoAbs), filepath.Ext(videoAbs))
	out := make([]indexedFile, 0, 4)
	for name, info := range snap.files {
		ext := strings.ToLower(filepath.Ext(name))
		if !isSubtitleExt(ext) {
			continue
		}
		nameBase := strings.TrimSuffix(name, filepath.Ext(name))
		if !sidecarMatchesVideo(videoBase, nameBase) {
			continue
		}
		out = append(out, indexedFile{name: name, info: info})
	}
	return out, nil
}

func (d *DirIndex) subtitleFingerprintEntries(videoAbs string) ([]fingerprintEntry, error) {
	files, err := d.subtitleFiles(videoAbs)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(videoAbs)
	out := make([]fingerprintEntry, 0, len(files))
	for _, file := range files {
		subPath := filepath.Join(dir, file.name)
		out = append(out, fingerprintEntry{
			path:    strings.ToLower(filepath.Clean(subPath)),
			size:    file.info.Size(),
			modNano: file.info.ModTime().UTC().UnixNano(),
		})
	}
	return out, nil
}

func (d *DirIndex) appendFileFingerprint(b *strings.Builder, kind string, path string) {
	clean := strings.ToLower(filepath.Clean(strings.TrimSpace(path)))
	if clean == "" || clean == "." {
		b.WriteString("|")
		b.WriteString(kind)
		b.WriteString(":")
		return
	}
	info, err := d.stat(path)
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

func (d *DirIndex) stat(path string) (os.FileInfo, error) {
	key := filepath.Clean(path)
	if cached, ok := d.stats[key]; ok {
		return cached.info, cached.err
	}
	statPath := d.statPath
	if statPath == nil {
		statPath = os.Stat
	}
	info, err := statPath(path)
	if err == nil || errors.Is(err, os.ErrNotExist) {
		d.stats[key] = cachedStat{info: info, err: err}
	}
	return info, err
}

func (d *DirIndex) snap(dir string) (*dirSnap, error) {
	key := filepath.Clean(dir)
	if snap, ok := d.snaps[key]; ok {
		return snap, snap.err
	}
	entries, err := d.readDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	snap := &dirSnap{err: err}
	if err == nil {
		snap.files = make(map[string]os.FileInfo, len(entries))
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			info, statErr := entry.Info()
			if statErr != nil {
				continue
			}
			snap.files[entry.Name()] = info
		}
	}
	d.snaps[key] = snap
	return snap, err
}

func sidecarMatchesVideo(videoBase string, nameBase string) bool {
	return nameBase == videoBase ||
		strings.HasPrefix(nameBase, videoBase+".") ||
		strings.HasPrefix(nameBase, videoBase+"_") ||
		strings.HasPrefix(nameBase, videoBase+"-")
}
