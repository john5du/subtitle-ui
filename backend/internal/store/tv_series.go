package store

import (
	"strconv"
	"strings"

	"subtitle-ui/backend/internal/domain"
)

// TVSeriesKeyUpdate is a stored grouping key for one TV episode.
type TVSeriesKeyUpdate struct {
	VideoID            string
	SeriesKey          string
	SeriesPath         string
	SeriesTitleSortKey string
}

func (s *Store) UpdateTVSeriesKeys(rows []TVSeriesKeyUpdate) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	for _, row := range rows {
		if strings.TrimSpace(row.VideoID) == "" {
			continue
		}
		if _, err = s.execTx(
			tx,
			`UPDATE videos SET series_key = ?, series_path = ?, series_title_sort_key = ? WHERE id = ?`,
			strings.TrimSpace(row.SeriesKey),
			strings.TrimSpace(row.SeriesPath),
			strings.TrimSpace(row.SeriesTitleSortKey),
			row.VideoID,
		); err != nil {
			return err
		}
	}
	err = tx.Commit()
	return err
}

func (s *Store) ListTVSeriesPage(query string, page int, pageSize int, sortBy string, sortOrder string) ([]domain.TVSeriesSummary, int, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	grouped := `
SELECT
  videos.series_key AS key,
  MAX(videos.series_path) AS path,
  COALESCE(
    (ARRAY_AGG(trim(videos.series_title) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_title, '')) <> ''))[1],
    (ARRAY_AGG(trim(videos.series_original_title) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_original_title, '')) <> ''))[1],
    COALESCE(substring(MAX(videos.series_path) FROM '[^/]+$'), MAX(videos.series_path), '')
  ) AS title,
  COALESCE((ARRAY_AGG(trim(videos.series_original_title) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_original_title, '')) <> ''))[1], '') AS original_title,
  COALESCE((ARRAY_AGG(trim(videos.series_imdb_id) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_imdb_id, '')) <> ''))[1], '') AS imdb_id,
  COALESCE((ARRAY_AGG(trim(videos.series_tmdb_id) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_tmdb_id, '')) <> ''))[1], '') AS tmdb_id,
  MAX(CASE WHEN trim(coalesce(videos.year, '')) ~ '^[0-9]+$' THEN CAST(trim(videos.year) AS INTEGER) ELSE 0 END) AS latest_year,
  MAX(videos.updated_at) AS updated_at,
  COUNT(*) AS video_count,
  SUM(CASE WHEN coalesce(sub_counts.n, 0) = 0 THEN 1 ELSE 0 END) AS no_subtitle_count,
  (ARRAY_AGG(videos.id ORDER BY videos.path) FILTER (WHERE trim(coalesce(videos.poster_path, '')) <> ''))[1] AS poster_video_id,
  (ARRAY_AGG(videos.series_title_sort_key ORDER BY (trim(coalesce(videos.series_title, '')) = '') ASC, (trim(coalesce(videos.series_original_title, '')) = '') ASC, videos.updated_at DESC))[1] AS title_sort_key
FROM videos
LEFT JOIN (
  SELECT video_id, COUNT(1) AS n FROM subtitles GROUP BY video_id
) sub_counts ON sub_counts.video_id = videos.id
WHERE videos.media_type = ?
  AND trim(videos.series_key) <> ''
GROUP BY videos.series_key`

	filterSQL, filterArgs := tvSeriesFilter(query)
	countQuery := `SELECT COUNT(1) FROM (` + grouped + `) series` + filterSQL
	countArgs := append([]any{domain.MediaTypeTV}, filterArgs...)
	total, err := s.countByQuery(countQuery, countArgs)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	listQuery := `SELECT key, path, title, original_title, imdb_id, tmdb_id, latest_year, updated_at, video_count, no_subtitle_count, poster_video_id, title_sort_key FROM (` + grouped + `) series` +
		filterSQL + " " + tvSeriesOrderBy(sortBy, sortOrder) + ` LIMIT ? OFFSET ?`
	listArgs := append(append([]any{domain.MediaTypeTV}, filterArgs...), pageSize, offset)

	rows, err := s.query(listQuery, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]domain.TVSeriesSummary, 0, pageSize)
	for rows.Next() {
		var (
			item          domain.TVSeriesSummary
			latestYear    int
			updatedRaw    string
			posterVideoID *string
			titleSortKey  string
			noSubtitle    int64
		)
		if err := rows.Scan(
			&item.Key,
			&item.Path,
			&item.Title,
			&item.OriginalTitle,
			&item.ImdbID,
			&item.TmdbID,
			&latestYear,
			&updatedRaw,
			&item.VideoCount,
			&noSubtitle,
			&posterVideoID,
			&titleSortKey,
		); err != nil {
			return nil, 0, err
		}
		_ = titleSortKey
		item.NoSubtitleCount = int(noSubtitle)
		if latestYear > 0 {
			item.LatestEpisodeYear = strconv.Itoa(latestYear)
		}
		item.UpdatedAt = strings.TrimSpace(updatedRaw)
		if posterVideoID != nil {
			item.PosterVideoID = strings.TrimSpace(*posterVideoID)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func tvSeriesFilter(query string) (string, []any) {
	needle := strings.TrimSpace(strings.ToLower(query))
	if needle == "" {
		return "", nil
	}
	like := "%" + needle + "%"
	return ` WHERE (lower(title) LIKE ? OR lower(original_title) LIKE ? OR lower(path) LIKE ? OR lower(imdb_id) LIKE ? OR lower(tmdb_id) LIKE ?)`,
		[]any{like, like, like, like, like}
}

func tvSeriesOrderBy(sortBy string, sortOrder string) string {
	dir := "DESC"
	if strings.ToLower(strings.TrimSpace(sortOrder)) == "asc" {
		dir = "ASC"
	}
	switch strings.ToLower(strings.TrimSpace(sortBy)) {
	case "title":
		return `ORDER BY title_sort_key ` + dir + `, lower(path) ASC`
	case "updatedat", "updated_at":
		return `ORDER BY (trim(coalesce(updated_at, '')) = '') ASC, updated_at ` + dir + `, title_sort_key ASC, lower(path) ASC`
	case "videocount", "video_count":
		return `ORDER BY video_count ` + dir + `, title_sort_key ASC, lower(path) ASC`
	case "nosubtitlecount", "no_subtitle_count":
		return `ORDER BY no_subtitle_count ` + dir + `, title_sort_key ASC, lower(path) ASC`
	default:
		return `ORDER BY (latest_year = 0) ASC, latest_year ` + dir + `, title_sort_key ASC, lower(path) ASC`
	}
}
