package scanner

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"hash/fnv"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

var videoExtensions = map[string]struct{}{
	".mp4":  {},
	".mkv":  {},
	".avi":  {},
	".mov":  {},
	".wmv":  {},
	".flv":  {},
	".m4v":  {},
	".mpeg": {},
	".mpg":  {},
}

var subtitleExtensions = map[string]struct{}{
	".srt": {},
	".ass": {},
	".ssa": {},
	".vtt": {},
	".sub": {},
}

var errMetadataNotFound = errors.New("metadata nfo not found")

type Scanner struct{}

type ScanStats struct {
	Found   int
	Rebuilt int
	Skipped int
}

type IncrementalScanResult struct {
	Found   []domain.Video
	Rebuilt map[string]struct{}
	Stats   ScanStats
}

type nfoMetadata struct {
	Title         string `xml:"title"`
	OriginalTitle string `xml:"originaltitle"`
	Year          string `xml:"year"`
	ImdbID        string `xml:"imdb_id"`
	TmdbID        string `xml:"tmdbid"`
}

func New() *Scanner {
	return &Scanner{}
}

func (s *Scanner) Scan(root string) ([]domain.Video, error) {
	return s.ScanWithType(root, domain.MediaTypeMovie)
}

func (s *Scanner) ScanWithType(root string, mediaType string) ([]domain.Video, error) {
	return s.ScanDirectoriesWithType([]string{root}, mediaType)
}

func (s *Scanner) ScanDirectoriesWithType(roots []string, mediaType string) ([]domain.Video, error) {
	return s.ScanDirectoriesWithTypeCtx(context.Background(), roots, mediaType)
}

func (s *Scanner) ScanDirectoriesWithTypeCtx(ctx context.Context, roots []string, mediaType string) ([]domain.Video, error) {
	result, err := s.ScanDirectoriesIncrementalCtx(ctx, roots, mediaType, nil, nil)
	return result.Found, err
}

// ScanDirectoriesIncrementalCtx walks roots and reuses previous rows when
// resolveFingerprint matches the stored ScanFingerprint. previous is keyed by
// absolute path. resolveFingerprint must return the same fingerprint that will
// be stored after a rebuild (including poster component).
func (s *Scanner) ScanDirectoriesIncrementalCtx(
	ctx context.Context,
	roots []string,
	mediaType string,
	previous map[string]domain.Video,
	resolveFingerprint func(videoPath string, mediaType string) (string, int64, time.Time, error),
) (IncrementalScanResult, error) {
	uniqueRoots := uniqueAbsDirectories(roots)
	out := IncrementalScanResult{
		Found:   make([]domain.Video, 0, 128),
		Rebuilt: make(map[string]struct{}, 64),
	}
	if len(uniqueRoots) == 0 {
		return out, nil
	}

	seenVideoPath := make(map[string]struct{}, 256)
	var scanErrs []error

	for _, rootAbs := range uniqueRoots {
		if err := ctx.Err(); err != nil {
			scanErrs = append(scanErrs, err)
			break
		}
		info, err := os.Stat(rootAbs)
		if err != nil {
			scanErrs = append(scanErrs, fmt.Errorf("stat root %s: %w", rootAbs, err))
			continue
		}
		if !info.IsDir() {
			scanErrs = append(scanErrs, fmt.Errorf("scan root is not a directory: %s", rootAbs))
			continue
		}

		walkErr := filepath.WalkDir(rootAbs, func(path string, d fs.DirEntry, walkErr error) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if walkErr != nil || d == nil || d.IsDir() {
				return nil
			}

			if !isVideoExt(filepath.Ext(d.Name())) {
				return nil
			}

			videoPath, err := filepath.Abs(path)
			if err != nil {
				return nil
			}
			if _, ok := seenVideoPath[videoPath]; ok {
				return nil
			}
			seenVideoPath[videoPath] = struct{}{}

			dir := filepath.Dir(videoPath)
			base := strings.TrimSuffix(filepath.Base(videoPath), filepath.Ext(videoPath))
			if !hasMetadataSidecar(dir, base, mediaType) {
				return nil
			}

			if previous != nil && resolveFingerprint != nil {
				if prev, ok := previous[videoPath]; ok {
					fp := strings.TrimSpace(prev.ScanFingerprint)
					if fp != "" {
						diskFP, size, modTime, fpErr := resolveFingerprint(videoPath, mediaType)
						if fpErr == nil && diskFP == fp {
							reused := prev
							reused.FileSize = size
							reused.FileModTime = modTime
							out.Found = append(out.Found, reused)
							out.Stats.Found++
							out.Stats.Skipped++
							return nil
						}
					}
				}
			}

			video, buildErr := s.buildVideo(videoPath, mediaType)
			if buildErr != nil {
				return nil
			}
			out.Found = append(out.Found, video)
			out.Rebuilt[video.Path] = struct{}{}
			out.Stats.Found++
			out.Stats.Rebuilt++
			return nil
		})
		if walkErr != nil {
			scanErrs = append(scanErrs, fmt.Errorf("walk %s: %w", rootAbs, walkErr))
		}
	}

	sort.Slice(out.Found, func(i int, j int) bool {
		if out.Found[i].Title == out.Found[j].Title {
			return out.Found[i].Path < out.Found[j].Path
		}
		return out.Found[i].Title < out.Found[j].Title
	})

	if len(scanErrs) > 0 {
		return out, joinErrors(scanErrs)
	}
	return out, nil
}

func (s *Scanner) DiscoverDirectories(root string, mediaType string) ([]domain.ScanDirectory, error) {
	return s.DiscoverDirectoriesCtx(context.Background(), root, mediaType)
}

func (s *Scanner) DiscoverDirectoriesCtx(ctx context.Context, root string, mediaType string) ([]domain.ScanDirectory, error) {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(rootAbs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("scan root is not a directory: %s", rootAbs)
	}

	type counter struct {
		videoCount    int
		metadataCount int
	}
	byDir := make(map[string]*counter, 256)

	walkErr := filepath.WalkDir(rootAbs, func(path string, d fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil || d == nil || d.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if !isVideoExt(ext) && !isMetadataExt(ext) {
			return nil
		}

		dir := filepath.Dir(path)
		item := byDir[dir]
		if item == nil {
			item = &counter{}
			byDir[dir] = item
		}
		if isVideoExt(ext) {
			item.videoCount++
		} else if isMetadataExt(ext) {
			item.metadataCount++
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	out := make([]domain.ScanDirectory, 0, len(byDir))
	for dir, c := range byDir {
		if c.videoCount == 0 && c.metadataCount == 0 {
			continue
		}
		out = append(out, domain.ScanDirectory{
			ID:                makeID(mediaType + ":" + dir),
			Path:              dir,
			MediaType:         mediaType,
			VideoFileCount:    c.videoCount,
			MetadataFileCount: c.metadataCount,
			HasVideo:          c.videoCount > 0,
			HasMetadata:       c.metadataCount > 0,
		})
	}

	sort.Slice(out, func(i int, j int) bool {
		return out[i].Path < out[j].Path
	})

	return out, nil
}

func (s *Scanner) ScanSubtitlesForVideo(videoPath string) ([]domain.Subtitle, error) {
	videoAbs, err := filepath.Abs(videoPath)
	if err != nil {
		return nil, err
	}

	dir := filepath.Dir(videoAbs)
	videoName := filepath.Base(videoAbs)
	videoBase := strings.TrimSuffix(videoName, filepath.Ext(videoName))

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	out := make([]domain.Subtitle, 0, 8)
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

		out = append(out, domain.Subtitle{
			ID:       makeID(videoAbs + "::" + subPath),
			Path:     subPath,
			FileName: entry.Name(),
			Language: subtitle.InferSidecarLanguageLabel(videoBase, entry.Name()),
			Format:   strings.TrimPrefix(ext, "."),
			Size:     info.Size(),
			ModTime:  info.ModTime(),
			Source:   domain.SubtitleSourceDirectory,
		})
	}

	sort.Slice(out, func(i int, j int) bool {
		return out[i].FileName < out[j].FileName
	})

	return out, nil
}

func (s *Scanner) buildVideo(path string, mediaType string) (domain.Video, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return domain.Video{}, err
	}

	dir := filepath.Dir(absPath)
	fileName := filepath.Base(absPath)
	base := strings.TrimSuffix(fileName, filepath.Ext(fileName))

	videoMetadata, source := readVideoMetadata(dir, base)
	seriesMetadata := nfoMetadata{}
	seriesSource := ""
	if mediaType == domain.MediaTypeTV {
		seriesMetadata, seriesSource = readTVSeriesMetadata(dir)
	}
	if source == "" && seriesSource != "" {
		source = seriesSource
	}
	if source == "" {
		return domain.Video{}, errMetadataNotFound
	}
	title := videoMetadata.Title
	if title == "" && mediaType == domain.MediaTypeTV {
		title = seriesMetadata.Title
	}
	if title == "" {
		title = base
	}
	year := videoMetadata.Year
	if year == "" && mediaType == domain.MediaTypeTV {
		year = seriesMetadata.Year
	}

	subtitles, err := s.ScanSubtitlesForVideo(absPath)
	if err != nil {
		subtitles = []domain.Subtitle{}
	}

	var fileSize int64
	var fileModTime time.Time
	if info, statErr := os.Stat(absPath); statErr == nil {
		fileSize = info.Size()
		fileModTime = info.ModTime().UTC()
	}

	return domain.Video{
		ID:                  makeID(absPath),
		Path:                absPath,
		Directory:           dir,
		FileName:            fileName,
		Title:               title,
		OriginalTitle:       videoMetadata.OriginalTitle,
		Year:                year,
		ImdbID:              videoMetadata.ImdbID,
		TmdbID:              videoMetadata.TmdbID,
		MediaType:           mediaType,
		MetadataSource:      source,
		SeriesTitle:         seriesMetadata.Title,
		SeriesOriginalTitle: seriesMetadata.OriginalTitle,
		SeriesImdbID:        seriesMetadata.ImdbID,
		SeriesTmdbID:        seriesMetadata.TmdbID,
		FileSize:            fileSize,
		FileModTime:         fileModTime,
		Subtitles:           subtitles,
		UpdatedAt:           time.Now().UTC(),
	}, nil
}

func readVideoMetadata(dir string, base string) (nfoMetadata, string) {
	directCandidates := []string{
		filepath.Join(dir, base+".nfo"),
		filepath.Join(dir, "movie.nfo"),
	}
	for _, path := range directCandidates {
		if metadata, ok := parseNFO(path); ok {
			return metadata, "nfo"
		}
	}
	return nfoMetadata{}, ""
}

func readTVSeriesMetadata(dir string) (nfoMetadata, string) {
	currentDir := dir
	for i := 0; i < 3; i++ {
		if metadata, ok := parseNFO(filepath.Join(currentDir, "tvshow.nfo")); ok {
			return metadata, "nfo"
		}
		parent := filepath.Dir(currentDir)
		if parent == currentDir {
			break
		}
		currentDir = parent
	}
	return nfoMetadata{}, ""
}

func parseNFO(path string) (nfoMetadata, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nfoMetadata{}, false
	}
	var parsed nfoMetadata
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return nfoMetadata{}, false
	}
	parsed.Title = strings.TrimSpace(parsed.Title)
	parsed.OriginalTitle = strings.TrimSpace(parsed.OriginalTitle)
	parsed.Year = strings.TrimSpace(parsed.Year)
	parsed.ImdbID = strings.TrimSpace(parsed.ImdbID)
	parsed.TmdbID = strings.TrimSpace(parsed.TmdbID)
	if parsed.Title == "" {
		parsed.Title = parsed.OriginalTitle
	}
	if parsed.Title == "" && parsed.OriginalTitle == "" && parsed.Year == "" && parsed.ImdbID == "" && parsed.TmdbID == "" {
		return nfoMetadata{}, false
	}
	return parsed, true
}

func isVideoExt(ext string) bool {
	_, ok := videoExtensions[strings.ToLower(ext)]
	return ok
}

func isSubtitleExt(ext string) bool {
	_, ok := subtitleExtensions[strings.ToLower(ext)]
	return ok
}

func isMetadataExt(ext string) bool {
	return strings.EqualFold(ext, ".nfo")
}

func makeID(s string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToLower(s)))
	return strings.ToUpper(strconvFormatUint(h.Sum64()))
}

func strconvFormatUint(v uint64) string {
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

func uniqueAbsDirectories(roots []string) []string {
	seen := make(map[string]struct{}, len(roots))
	out := make([]string, 0, len(roots))
	for _, raw := range roots {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		abs, err := filepath.Abs(raw)
		if err != nil {
			continue
		}
		abs = filepath.Clean(abs)
		key := strings.ToLower(abs)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, abs)
	}
	return out
}

func joinErrors(errs []error) error {
	if len(errs) == 0 {
		return nil
	}
	if len(errs) == 1 {
		return errs[0]
	}
	var b strings.Builder
	for i, err := range errs {
		if i > 0 {
			b.WriteString("; ")
		}
		b.WriteString(err.Error())
	}
	return errors.New(b.String())
}
