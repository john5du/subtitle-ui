package app

import (
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/textsort"
)

func (s *Service) ListTVSeriesPage(query string, page int, pageSize int, sortBy string, sortOrder string) domain.TVSeriesPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	videos, err := s.listAllTVVideos()
	if err != nil {
		return domain.TVSeriesPage{
			Items:      []domain.TVSeriesSummary{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	rows := buildTVSeriesSummaries(videos, s.cfg.TVMediaRoot)
	rows = filterTVSeriesSummaries(rows, query)
	sortTVSeriesSummaries(rows, sortBy, sortOrder)

	total := len(rows)
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	start := (page - 1) * pageSize
	if start >= total {
		return domain.TVSeriesPage{
			Items:      []domain.TVSeriesSummary{},
			Total:      total,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
		}
	}

	end := start + pageSize
	if end > total {
		end = total
	}

	return domain.TVSeriesPage{
		Items:      rows[start:end],
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

func buildTVSeriesSummaries(videos []domain.Video, tvRootPath string) []domain.TVSeriesSummary {
	type group struct {
		item        domain.TVSeriesSummary
		latestYear  int
		updatedTime time.Time
	}
	bySeries := make(map[string]*group, 128)

	for _, video := range videos {
		key, seriesPath, fallbackTitle := resolveTVSeriesFromVideo(video, tvRootPath)
		seriesTitle := strings.TrimSpace(video.SeriesTitle)
		seriesOriginalTitle := strings.TrimSpace(video.SeriesOriginalTitle)
		item, ok := bySeries[key]
		if !ok {
			item = &group{
				item: domain.TVSeriesSummary{
					Key:             key,
					Path:            seriesPath,
					Title:           firstNonEmpty(seriesTitle, seriesOriginalTitle, fallbackTitle, video.Title, "Unknown"),
					OriginalTitle:   seriesOriginalTitle,
					ImdbID:          strings.TrimSpace(video.SeriesImdbID),
					TmdbID:          strings.TrimSpace(video.SeriesTmdbID),
					UpdatedAt:       video.UpdatedAt.UTC().Format(time.RFC3339Nano),
					VideoCount:      0,
					NoSubtitleCount: 0,
				},
				latestYear:  0,
				updatedTime: video.UpdatedAt.UTC(),
			}
			bySeries[key] = item
		}
		if seriesTitle != "" {
			item.item.Title = seriesTitle
		}
		if seriesOriginalTitle != "" {
			item.item.OriginalTitle = seriesOriginalTitle
		}
		if imdbID := strings.TrimSpace(video.SeriesImdbID); imdbID != "" {
			item.item.ImdbID = imdbID
		}
		if tmdbID := strings.TrimSpace(video.SeriesTmdbID); tmdbID != "" {
			item.item.TmdbID = tmdbID
		}

		item.item.VideoCount += 1
		if len(video.Subtitles) == 0 {
			item.item.NoSubtitleCount += 1
		}
		if item.item.PosterVideoID == "" && strings.TrimSpace(video.PosterPath) != "" {
			item.item.PosterVideoID = video.ID
		}

		if year := parseYearNumber(video.Year); year > item.latestYear {
			item.latestYear = year
			item.item.LatestEpisodeYear = strconv.Itoa(year)
		}

		if video.UpdatedAt.After(item.updatedTime) {
			item.updatedTime = video.UpdatedAt.UTC()
			item.item.UpdatedAt = video.UpdatedAt.UTC().Format(time.RFC3339Nano)
		}
	}

	rows := make([]domain.TVSeriesSummary, 0, len(bySeries))
	for _, row := range bySeries {
		rows = append(rows, row.item)
	}
	return rows
}

func filterTVSeriesSummaries(items []domain.TVSeriesSummary, query string) []domain.TVSeriesSummary {
	needle := strings.TrimSpace(strings.ToLower(query))
	if needle == "" {
		return items
	}

	filtered := make([]domain.TVSeriesSummary, 0, len(items))
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.Title), needle) ||
			strings.Contains(strings.ToLower(item.OriginalTitle), needle) ||
			strings.Contains(strings.ToLower(item.Path), needle) ||
			strings.Contains(strings.ToLower(item.ImdbID), needle) ||
			strings.Contains(strings.ToLower(item.TmdbID), needle) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func normalizeTVSeriesSortBy(sortBy string) string {
	switch strings.ToLower(strings.TrimSpace(sortBy)) {
	case "title":
		return "title"
	case "updatedat", "updated_at":
		return "updatedAt"
	case "videocount", "video_count":
		return "videoCount"
	case "nosubtitlecount", "no_subtitle_count":
		return "noSubtitleCount"
	case "year", "latestyear", "latest_year", "latestepisodeyear":
		return "year"
	default:
		return "year"
	}
}

func compareTVSeriesTieBreak(a, b domain.TVSeriesSummary) bool {
	if textsort.Less(a.Title, b.Title) {
		return true
	}
	if textsort.Less(b.Title, a.Title) {
		return false
	}
	return strings.ToLower(a.Path) < strings.ToLower(b.Path)
}

func sortTVSeriesSummaries(items []domain.TVSeriesSummary, sortBy string, sortOrder string) {
	order := normalizeSortOrder(sortOrder)
	field := normalizeTVSeriesSortBy(sortBy)
	asc := order == "asc"

	sort.Slice(items, func(i int, j int) bool {
		a := items[i]
		b := items[j]

		switch field {
		case "title":
			lessAB := textsort.Less(a.Title, b.Title)
			lessBA := textsort.Less(b.Title, a.Title)
			if lessAB != lessBA {
				if asc {
					return lessAB
				}
				return lessBA
			}
			return strings.ToLower(a.Path) < strings.ToLower(b.Path)
		case "updatedAt":
			timeA, errA := time.Parse(time.RFC3339Nano, a.UpdatedAt)
			if errA != nil {
				timeA, errA = time.Parse(time.RFC3339, a.UpdatedAt)
			}
			timeB, errB := time.Parse(time.RFC3339Nano, b.UpdatedAt)
			if errB != nil {
				timeB, errB = time.Parse(time.RFC3339, b.UpdatedAt)
			}
			hasA := errA == nil && !timeA.IsZero()
			hasB := errB == nil && !timeB.IsZero()
			if hasA != hasB {
				return hasA
			}
			if hasA && hasB && !timeA.Equal(timeB) {
				if asc {
					return timeA.Before(timeB)
				}
				return timeA.After(timeB)
			}
			return compareTVSeriesTieBreak(a, b)
		case "videoCount":
			if a.VideoCount != b.VideoCount {
				if asc {
					return a.VideoCount < b.VideoCount
				}
				return a.VideoCount > b.VideoCount
			}
			return compareTVSeriesTieBreak(a, b)
		case "noSubtitleCount":
			if a.NoSubtitleCount != b.NoSubtitleCount {
				if asc {
					return a.NoSubtitleCount < b.NoSubtitleCount
				}
				return a.NoSubtitleCount > b.NoSubtitleCount
			}
			return compareTVSeriesTieBreak(a, b)
		default:
			yearA := parseYearNumber(a.LatestEpisodeYear)
			yearB := parseYearNumber(b.LatestEpisodeYear)
			hasYearA := yearA > 0
			hasYearB := yearB > 0
			if hasYearA != hasYearB {
				return hasYearA
			}
			if hasYearA && hasYearB && yearA != yearB {
				if asc {
					return yearA < yearB
				}
				return yearA > yearB
			}
			return compareTVSeriesTieBreak(a, b)
		}
	})
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

func parseYearNumber(raw string) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0
	}
	year, err := strconv.Atoi(trimmed)
	if err != nil || year <= 0 {
		return 0
	}
	return year
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizeSortOrder(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "asc":
		return "asc"
	default:
		return "desc"
	}
}
