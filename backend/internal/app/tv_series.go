package app

import (
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
	"subtitle-ui/backend/internal/textsort"
)

func (s *Service) ListTVSeriesPage(query string, page int, pageSize int, sortBy string, sortOrder string) (domain.TVSeriesPage, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	rows, total, err := s.store.ListTVSeriesPage(query, page, pageSize, sortBy, sortOrder)
	if err != nil {
		return domain.TVSeriesPage{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	if rows == nil {
		rows = []domain.TVSeriesSummary{}
	}
	return domain.TVSeriesPage{
		Items:      rows,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (s *Service) backfillTVSeriesKeys() error {
	videos, err := s.store.ListAllVideosMeta(domain.MediaTypeTV)
	if err != nil {
		return err
	}
	return s.store.UpdateTVSeriesKeys(collectTVSeriesKeyUpdates(videos, s.cfg.TVMediaRoot))
}

func (s *Service) syncSkippedTVSeriesKeys(found []domain.Video, rebuilt []domain.Video, previousByPath map[string]domain.Video) error {
	rebuiltIDs := make(map[string]struct{}, len(rebuilt))
	for _, video := range rebuilt {
		rebuiltIDs[video.ID] = struct{}{}
	}
	skipped := make([]domain.Video, 0)
	for _, video := range found {
		if _, ok := rebuiltIDs[video.ID]; ok {
			continue
		}
		if prev, ok := previousByPath[video.Path]; ok {
			video.SeriesKey = prev.SeriesKey
			video.SeriesPath = prev.SeriesPath
			video.SeriesTitleSortKey = prev.SeriesTitleSortKey
			if video.MediaType == "" {
				video.MediaType = prev.MediaType
			}
		}
		skipped = append(skipped, video)
	}
	return s.store.UpdateTVSeriesKeys(collectTVSeriesKeyUpdates(skipped, s.cfg.TVMediaRoot))
}

func collectTVSeriesKeyUpdates(videos []domain.Video, tvRootPath string) []store.TVSeriesKeyUpdate {
	updates := make([]store.TVSeriesKeyUpdate, 0)
	for i := range videos {
		beforeKey := videos[i].SeriesKey
		beforePath := videos[i].SeriesPath
		beforeSort := videos[i].SeriesTitleSortKey
		annotateVideoSeriesFields(&videos[i], tvRootPath)
		if videos[i].SeriesKey == beforeKey && videos[i].SeriesPath == beforePath && videos[i].SeriesTitleSortKey == beforeSort {
			continue
		}
		if strings.TrimSpace(videos[i].SeriesKey) == "" {
			continue
		}
		updates = append(updates, store.TVSeriesKeyUpdate{
			VideoID:            videos[i].ID,
			SeriesKey:          videos[i].SeriesKey,
			SeriesPath:         videos[i].SeriesPath,
			SeriesTitleSortKey: videos[i].SeriesTitleSortKey,
		})
	}
	return updates
}

func annotateVideoSeriesFields(video *domain.Video, tvRootPath string) {
	if video == nil {
		return
	}
	if video.MediaType != domain.MediaTypeTV {
		video.SeriesKey = ""
		video.SeriesPath = ""
		video.SeriesTitleSortKey = ""
		return
	}
	key, seriesPath, fallback := resolveTVSeriesFromVideo(*video, tvRootPath)
	video.SeriesKey = key
	video.SeriesPath = seriesPath
	title := firstNonEmpty(video.SeriesTitle, video.SeriesOriginalTitle, fallback, video.Title, "Unknown")
	video.SeriesTitleSortKey = textsort.SortKey(title)
}

func resolveTVSeriesFromVideo(video domain.Video, tvRootPath string) (string, string, string) {
	videoDir := strings.TrimSpace(video.Directory)
	if videoDir == "" {
		videoDir = filepath.Dir(video.Path)
	}
	seriesPath := filepath.Clean(videoDir)
	seriesTitle := filepath.Base(seriesPath)
	if seriesTitle == "" || seriesTitle == "." || seriesTitle == string(filepath.Separator) {
		seriesTitle = strings.TrimSpace(video.Title)
	}
	if seriesTitle == "" {
		seriesTitle = "Unknown"
	}

	root := strings.TrimSpace(tvRootPath)
	if root != "" {
		rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(videoDir))
		if err == nil {
			rel = filepath.ToSlash(rel)
			if rel != "." && rel != ".." && !strings.HasPrefix(rel, "../") {
				parts := strings.Split(rel, "/")
				if len(parts) > 0 && strings.TrimSpace(parts[0]) != "" {
					seriesTitle = parts[0]
					seriesPath = filepath.Join(filepath.Clean(root), seriesTitle)
				}
			}
		}
	}

	key := tvSeriesKeyFromPath(seriesPath, seriesTitle)
	return key, seriesPath, seriesTitle
}

func tvSeriesKeyFromPath(seriesPath string, seriesTitle string) string {
	key := strings.ToLower(filepath.ToSlash(filepath.Clean(seriesPath)))
	if key == "" {
		return strings.ToLower(seriesTitle)
	}
	return key
}

func computeTVSeriesKeyFromDir(videoDir string, tvRootPath string) string {
	if strings.TrimSpace(videoDir) == "" {
		return ""
	}
	seriesPath := filepath.Clean(videoDir)
	root := strings.TrimSpace(tvRootPath)
	if root != "" {
		rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(videoDir))
		if err == nil {
			rel = filepath.ToSlash(rel)
			if rel != "." && rel != ".." && !strings.HasPrefix(rel, "../") {
				parts := strings.Split(rel, "/")
				if len(parts) > 0 && strings.TrimSpace(parts[0]) != "" {
					seriesPath = filepath.Join(filepath.Clean(root), parts[0])
				}
			}
		}
	}
	return tvSeriesKeyFromPath(seriesPath, filepath.Base(seriesPath))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
