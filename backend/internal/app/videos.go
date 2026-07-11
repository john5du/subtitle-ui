package app

import (
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/textsort"
	"subtitle-ui/backend/internal/version"
)

func (s *Service) ListVideosPage(query string, mediaType string, directory string, page int, pageSize int, sortBy string, sortOrder string) domain.VideoPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	videos, total, err := s.store.ListVideos(query, mediaType, directory, page, pageSize, sortBy, sortOrder)
	if err != nil {
		return domain.VideoPage{
			Items:      []domain.Video{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return domain.VideoPage{
		Items:      videos,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

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

func (s *Service) VersionInfo() domain.VersionInfo {
	return domain.VersionInfo{
		Version:      version.Value,
		DatabaseType: s.store.DatabaseType(),
	}
}

func (s *Service) GetVideo(videoID string) (domain.Video, bool) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, false
	}
	return video, found
}

func (s *Service) listAllTVVideos() ([]domain.Video, error) {
	return s.listAllVideosByType(domain.MediaTypeTV)
}

func (s *Service) listAllVideos() ([]domain.Video, error) {
	return s.listAllVideosByType("")
}

func (s *Service) listAllVideosByType(mediaType string) ([]domain.Video, error) {
	out := make([]domain.Video, 0, 256)
	page := 1
	pageSize := 200
	total := 0

	for {
		items, itemTotal, err := s.store.ListVideos("", mediaType, "", page, pageSize, "", "")
		if err != nil {
			return nil, err
		}
		if page == 1 {
			total = itemTotal
		}

		out = append(out, items...)
		if len(items) == 0 || len(out) >= total {
			break
		}
		page += 1
	}

	return out, nil
}

type videoChanges struct {
	Added   int
	Removed int
	Updated int
}

func calculateVideoChanges(before []domain.Video, current []domain.Video) videoChanges {
	beforeSignatures := make(map[string]string, len(before))
	for _, video := range before {
		beforeSignatures[video.ID] = videoContentSignature(video)
	}

	currentSignatures := make(map[string]string, len(current))
	for _, video := range current {
		currentSignatures[video.ID] = videoContentSignature(video)
	}

	changes := videoChanges{}
	for id, currentSig := range currentSignatures {
		beforeSig, ok := beforeSignatures[id]
		if !ok {
			changes.Added++
			continue
		}
		if beforeSig != currentSig {
			changes.Updated++
		}
	}
	for id := range beforeSignatures {
		if _, ok := currentSignatures[id]; !ok {
			changes.Removed++
		}
	}
	return changes
}

func videoContentSignature(video domain.Video) string {
	var b strings.Builder
	b.Grow(256)
	b.WriteString(strings.ToLower(strings.TrimSpace(video.Path)))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.Title))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.OriginalTitle))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.Year))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.ImdbID))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.TmdbID))
	b.WriteString("|")
	b.WriteString(strings.ToLower(strings.TrimSpace(video.MediaType)))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.MetadataSource))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesTitle))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesOriginalTitle))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesImdbID))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesTmdbID))
	b.WriteString("|")
	b.WriteString(strings.ToLower(strings.TrimSpace(video.PosterPath)))

	subs := append([]domain.Subtitle(nil), video.Subtitles...)
	sort.Slice(subs, func(i int, j int) bool {
		if !strings.EqualFold(subs[i].Path, subs[j].Path) {
			return strings.ToLower(subs[i].Path) < strings.ToLower(subs[j].Path)
		}
		return strings.ToLower(subs[i].FileName) < strings.ToLower(subs[j].FileName)
	})
	for _, sub := range subs {
		b.WriteString("|")
		b.WriteString(strings.ToLower(strings.TrimSpace(sub.Path)))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.FileName))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Language))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Format))
		b.WriteString(":")
		b.WriteString(strconv.FormatInt(sub.Size, 10))
		b.WriteString(":")
		b.WriteString(sub.ModTime.UTC().Format(time.RFC3339Nano))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Source))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.SourceDetail))
	}
	return b.String()
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
