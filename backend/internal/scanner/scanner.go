package scanner

import (
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

type nfoMetadata struct {
	Title         string `xml:"title"`
	OriginalTitle string `xml:"originaltitle"`
	Year          string `xml:"year"`
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
	uniqueRoots := uniqueAbsDirectories(roots)
	if len(uniqueRoots) == 0 {
		return []domain.Video{}, nil
	}

	videos := make([]domain.Video, 0, 128)
	seenVideoPath := make(map[string]struct{}, 256)
	var scanErrs []error

	for _, rootAbs := range uniqueRoots {
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

			video, buildErr := s.buildVideo(videoPath, mediaType)
			if buildErr != nil {
				return nil
			}
			videos = append(videos, video)
			return nil
		})
		if walkErr != nil {
			scanErrs = append(scanErrs, fmt.Errorf("walk %s: %w", rootAbs, walkErr))
		}
	}

	sort.Slice(videos, func(i int, j int) bool {
		if videos[i].Title == videos[j].Title {
			return videos[i].Path < videos[j].Path
		}
		return videos[i].Title < videos[j].Title
	})

	if len(scanErrs) > 0 {
		return videos, joinErrors(scanErrs)
	}
	return videos, nil
}

func (s *Scanner) DiscoverDirectories(root string, mediaType string) ([]domain.ScanDirectory, error) {
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
			Language: inferLanguage(videoBase, entry.Name()),
			Format:   strings.TrimPrefix(ext, "."),
			Size:     info.Size(),
			ModTime:  info.ModTime(),
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

	title, year, source := readMetadata(dir, base)
	if source == "" {
		return domain.Video{}, errMetadataNotFound
	}
	if title == "" {
		title = base
	}

	subtitles, err := s.ScanSubtitlesForVideo(absPath)
	if err != nil {
		subtitles = []domain.Subtitle{}
	}

	return domain.Video{
		ID:             makeID(absPath),
		Path:           absPath,
		Directory:      dir,
		FileName:       fileName,
		Title:          title,
		Year:           year,
		MediaType:      mediaType,
		MetadataSource: source,
		Subtitles:      subtitles,
		UpdatedAt:      time.Now().UTC(),
	}, nil
}

func readMetadata(dir string, base string) (title string, year string, source string) {
	candidates := []string{
		filepath.Join(dir, base+".nfo"),
		filepath.Join(dir, "movie.nfo"),
	}

	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		var parsed nfoMetadata
		if err := xml.Unmarshal(data, &parsed); err != nil {
			continue
		}

		title = strings.TrimSpace(parsed.Title)
		if title == "" {
			title = strings.TrimSpace(parsed.OriginalTitle)
		}
		year = strings.TrimSpace(parsed.Year)
		if title != "" || year != "" {
			return title, year, "nfo"
		}
	}

	return "", "", ""
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

func inferLanguage(videoBase string, subtitleName string) string {
	nameNoExt := strings.TrimSuffix(subtitleName, filepath.Ext(subtitleName))
	if nameNoExt == videoBase {
		return "und"
	}

	suffix := strings.TrimPrefix(nameNoExt, videoBase)
	suffix = strings.Trim(suffix, "._- ")
	if suffix == "" {
		return "und"
	}

	parts := strings.FieldsFunc(suffix, func(r rune) bool {
		return r == '.' || r == '_' || r == '-' || r == ' '
	})
	if len(parts) == 0 {
		return "und"
	}

	return strings.ToLower(parts[len(parts)-1])
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
