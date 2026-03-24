package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

var posterExtensions = []string{".jpg", ".png", ".bmp"}

func (s *Service) assignPosterPaths(videos []domain.Video) []domain.Video {
	if len(videos) == 0 {
		return videos
	}

	out := make([]domain.Video, len(videos))
	copy(out, videos)

	movieCache := make(map[string]string, len(out))
	tvCache := make(map[string]string, len(out))

	for i := range out {
		switch normalizePosterMediaType(out[i].MediaType) {
		case domain.MediaTypeMovie:
			out[i].PosterPath = s.findMoviePosterPath(out[i], movieCache)
		case domain.MediaTypeTV:
			out[i].PosterPath = s.findTVPosterPath(out[i], tvCache)
		}
	}

	return out
}

func (s *Service) ResolveVideoPosterPath(videoID string) (string, error) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return "", err
	}
	if !found {
		return "", ErrNotFound
	}

	posterPath := strings.TrimSpace(video.PosterPath)
	if posterPath == "" {
		return "", ErrNotFound
	}

	cleanPosterPath := filepath.Clean(posterPath)
	if !isAllowedPosterExtension(cleanPosterPath) {
		return "", ErrNotFound
	}
	if !isAllowedPosterCandidate(video, cleanPosterPath, s.cfg.TVMediaRoot) {
		return "", ErrUnsafePath
	}

	info, err := os.Stat(cleanPosterPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrNotFound
		}
		return "", err
	}
	if info.IsDir() {
		return "", ErrNotFound
	}

	return cleanPosterPath, nil
}

func (s *Service) findMoviePosterPath(video domain.Video, cache map[string]string) string {
	dir := videoDirectory(video)
	if dir == "" || !subtitle.EnsureWithinRoot(s.cfg.MovieMediaRoot, dir) {
		return ""
	}

	cacheKey := strings.ToLower(filepath.Clean(dir) + "|" + moviePosterBaseName(video))
	if cached, ok := cache[cacheKey]; ok {
		return cached
	}

	found := findPosterInDirectory(dir, moviePosterNames(video))
	if found != "" && !subtitle.EnsureWithinRoot(s.cfg.MovieMediaRoot, found) {
		found = ""
	}
	cache[cacheKey] = found
	return found
}

func (s *Service) findTVPosterPath(video domain.Video, cache map[string]string) string {
	_, seriesPath, _ := resolveTVSeriesFromVideo(video, s.cfg.TVMediaRoot)
	if seriesPath == "" || !subtitle.EnsureWithinRoot(s.cfg.TVMediaRoot, seriesPath) {
		return ""
	}

	cacheKey := strings.ToLower(filepath.Clean(seriesPath))
	if cached, ok := cache[cacheKey]; ok {
		return cached
	}

	found := findPosterInDirectory(seriesPath, tvPosterNames())
	if found != "" && !subtitle.EnsureWithinRoot(s.cfg.TVMediaRoot, found) {
		found = ""
	}
	cache[cacheKey] = found
	return found
}

func findPosterInDirectory(dir string, names []string) string {
	cleanDir := strings.TrimSpace(dir)
	if cleanDir == "" {
		return ""
	}

	for _, name := range names {
		for _, ext := range posterExtensions {
			candidate := filepath.Join(cleanDir, name+ext)
			info, err := os.Stat(candidate)
			if err != nil || info.IsDir() {
				continue
			}
			return filepath.Clean(candidate)
		}
	}

	return ""
}

func isAllowedPosterCandidate(video domain.Video, posterPath string, tvRoot string) bool {
	allowed := posterCandidatePaths(video, tvRoot)
	cleanPosterPath := strings.ToLower(filepath.Clean(posterPath))
	for _, candidate := range allowed {
		if strings.EqualFold(candidate, cleanPosterPath) || strings.EqualFold(filepath.Clean(candidate), cleanPosterPath) {
			return true
		}
	}
	return false
}

func posterCandidatePaths(video domain.Video, tvRoot string) []string {
	switch normalizePosterMediaType(video.MediaType) {
	case domain.MediaTypeMovie:
		dir := videoDirectory(video)
		if dir == "" {
			return nil
		}
		return expandPosterCandidatePaths(dir, moviePosterNames(video))
	case domain.MediaTypeTV:
		_, seriesPath, _ := resolveTVSeriesFromVideo(video, tvRoot)
		if seriesPath == "" {
			return nil
		}
		return expandPosterCandidatePaths(seriesPath, tvPosterNames())
	default:
		return nil
	}
}

func expandPosterCandidatePaths(dir string, names []string) []string {
	paths := make([]string, 0, len(names)*len(posterExtensions))
	for _, name := range names {
		for _, ext := range posterExtensions {
			paths = append(paths, strings.ToLower(filepath.Clean(filepath.Join(dir, name+ext))))
		}
	}
	return paths
}

func moviePosterNames(video domain.Video) []string {
	base := moviePosterBaseName(video)
	names := []string{"poster", "movie", "folder"}
	if base != "" {
		names = append(names, base+"-poster", base)
	}
	names = append(names, "cover")
	return names
}

func moviePosterBaseName(video domain.Video) string {
	name := strings.TrimSpace(video.FileName)
	if name == "" {
		name = filepath.Base(strings.TrimSpace(video.Path))
	}
	return strings.TrimSuffix(name, filepath.Ext(name))
}

func tvPosterNames() []string {
	return []string{"poster", "folder", "fanart"}
}

func videoDirectory(video domain.Video) string {
	dir := strings.TrimSpace(video.Directory)
	if dir != "" {
		return filepath.Clean(dir)
	}
	path := strings.TrimSpace(video.Path)
	if path == "" {
		return ""
	}
	return filepath.Dir(filepath.Clean(path))
}

func normalizePosterMediaType(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case domain.MediaTypeTV:
		return domain.MediaTypeTV
	default:
		return domain.MediaTypeMovie
	}
}

func isAllowedPosterExtension(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	for _, candidate := range posterExtensions {
		if ext == candidate {
			return true
		}
	}
	return false
}
