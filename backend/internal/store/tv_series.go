package store

import (
	"database/sql"
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
	affected := make([]string, 0, len(rows)*2)
	for _, row := range rows {
		if strings.TrimSpace(row.VideoID) == "" {
			continue
		}
		var oldKey string
		scanErr := s.queryRowTx(tx, `SELECT series_key FROM videos WHERE id = ?`, row.VideoID).Scan(&oldKey)
		if scanErr != nil && scanErr != sql.ErrNoRows {
			err = scanErr
			return err
		}
		affected = append(affected, oldKey, row.SeriesKey)
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
	if err = s.refreshTVSeriesTx(tx, affected); err != nil {
		return err
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

	filterSQL, filterArgs := tvSeriesFilter(query)
	countQuery := `SELECT COUNT(1) FROM tv_series` + filterSQL
	total, err := s.countByQuery(countQuery, filterArgs)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	listQuery := `SELECT series_key, path, title, original_title, imdb_id, tmdb_id, latest_year, updated_at, video_count, no_subtitle_count, poster_video_id FROM tv_series` +
		filterSQL + " " + tvSeriesOrderBy(sortBy, sortOrder) + ` LIMIT ? OFFSET ?`
	listArgs := append(append([]any{}, filterArgs...), pageSize, offset)

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
			posterVideoID string
			noSubtitle    int
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
		); err != nil {
			return nil, 0, err
		}
		item.NoSubtitleCount = noSubtitle
		if latestYear > 0 {
			item.LatestEpisodeYear = strconv.Itoa(latestYear)
		}
		item.UpdatedAt = strings.TrimSpace(updatedRaw)
		item.PosterVideoID = strings.TrimSpace(posterVideoID)
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

func (s *Store) rebuildAllTVSeries() error {
	_, err := s.exec(tvSeriesUpsertSQL(0), domain.MediaTypeTV, domain.MediaTypeTV)
	return err
}

// refreshTVSeriesTx recomputes summary rows for the given series keys and
// deletes keys that no longer have episodes. Empty keys are ignored.
// Advisory locks are taken after the caller's video writes so scans and
// subtitle updates acquire the video row first, then the series lock.
func (s *Store) refreshTVSeriesTx(tx *sql.Tx, keys []string) error {
	keys = uniqueSeriesKeys(keys)
	if len(keys) == 0 {
		return nil
	}
	for _, key := range keys {
		if _, err := s.execTx(tx, `SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || '/' || ?, 0))`, key); err != nil {
			return err
		}
	}
	args := make([]any, 0, 2*(1+len(keys)))
	// Subquery placeholders come first, then the same media type and keys for the outer query.
	for range 2 {
		args = append(args, domain.MediaTypeTV)
		for _, key := range keys {
			args = append(args, key)
		}
	}
	if _, err := s.execTx(tx, tvSeriesUpsertSQL(len(keys)), args...); err != nil {
		return err
	}
	delArgs := make([]any, 0, len(keys)+1)
	for _, key := range keys {
		delArgs = append(delArgs, key)
	}
	delArgs = append(delArgs, domain.MediaTypeTV)
	_, err := s.execTx(tx, `DELETE FROM tv_series WHERE series_key IN (`+placeholders(len(keys))+`)
AND NOT EXISTS (
  SELECT 1 FROM videos
  WHERE videos.series_key = tv_series.series_key
    AND videos.media_type = ?
    AND trim(videos.series_key) <> ''
)`, delArgs...)
	return err
}

func uniqueSeriesKeys(keys []string) []string {
	if len(keys) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func seriesKeyInFilter(alias string, keyCount int) string {
	if keyCount <= 0 {
		return ""
	}
	return ` AND ` + alias + `.series_key IN (` + placeholders(keyCount) + `)`
}

func tvSeriesUpsertSQL(keyCount int) string {
	return `INSERT INTO tv_series(
  series_key, path, title, original_title, imdb_id, tmdb_id, latest_year, updated_at,
  video_count, no_subtitle_count, poster_video_id, title_sort_key
)
SELECT
  videos.series_key,
  COALESCE(MAX(videos.series_path), ''),
  COALESCE(
    (ARRAY_AGG(trim(videos.series_title) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_title, '')) <> ''))[1],
    (ARRAY_AGG(trim(videos.series_original_title) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_original_title, '')) <> ''))[1],
    COALESCE(substring(MAX(videos.series_path) FROM '[^/]+$'), MAX(videos.series_path), ''),
    ''
  ),
  COALESCE((ARRAY_AGG(trim(videos.series_original_title) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_original_title, '')) <> ''))[1], ''),
  COALESCE((ARRAY_AGG(trim(videos.series_imdb_id) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_imdb_id, '')) <> ''))[1], ''),
  COALESCE((ARRAY_AGG(trim(videos.series_tmdb_id) ORDER BY videos.updated_at DESC) FILTER (WHERE trim(coalesce(videos.series_tmdb_id, '')) <> ''))[1], ''),
  MAX(CASE WHEN trim(coalesce(videos.year, '')) ~ '^[0-9]+$' THEN CAST(trim(videos.year) AS INTEGER) ELSE 0 END),
  COALESCE(MAX(videos.updated_at), ''),
  CAST(COUNT(*) AS INTEGER),
  CAST(SUM(CASE WHEN coalesce(sub_counts.n, 0) = 0 THEN 1 ELSE 0 END) AS INTEGER),
  COALESCE((ARRAY_AGG(videos.id ORDER BY videos.path) FILTER (WHERE trim(coalesce(videos.poster_path, '')) <> ''))[1], ''),
  COALESCE((ARRAY_AGG(videos.series_title_sort_key ORDER BY (trim(coalesce(videos.series_title, '')) = '') ASC, (trim(coalesce(videos.series_original_title, '')) = '') ASC, videos.updated_at DESC))[1], '')
FROM videos
LEFT JOIN (
  SELECT subtitles.video_id, COUNT(1) AS n
  FROM subtitles
  INNER JOIN videos AS series_videos ON series_videos.id = subtitles.video_id
  WHERE series_videos.media_type = ?
    AND trim(series_videos.series_key) <> ''
` + seriesKeyInFilter("series_videos", keyCount) + `
  GROUP BY subtitles.video_id
) sub_counts ON sub_counts.video_id = videos.id
WHERE videos.media_type = ?
  AND trim(videos.series_key) <> ''
` + seriesKeyInFilter("videos", keyCount) + `
GROUP BY videos.series_key
ON CONFLICT(series_key) DO UPDATE SET
  path = excluded.path,
  title = excluded.title,
  original_title = excluded.original_title,
  imdb_id = excluded.imdb_id,
  tmdb_id = excluded.tmdb_id,
  latest_year = excluded.latest_year,
  updated_at = excluded.updated_at,
  video_count = excluded.video_count,
  no_subtitle_count = excluded.no_subtitle_count,
  poster_video_id = excluded.poster_video_id,
  title_sort_key = excluded.title_sort_key`
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
