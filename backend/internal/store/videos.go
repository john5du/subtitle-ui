package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
)

func (s *Store) ListVideos(query string, mediaType string, directory string, page int, pageSize int, sortBy string, sortOrder string) ([]domain.Video, int, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	baseQuery := `SELECT id, path, directory, file_name, title, original_title, year, imdb_id, tmdb_id, media_type, metadata_source, series_title, series_original_title, series_imdb_id, series_tmdb_id, poster_path, updated_at FROM videos`
	args := []any{}
	conditions := make([]string, 0, 2)

	needle := strings.TrimSpace(strings.ToLower(query))
	if needle != "" {
		conditions = append(conditions, `(lower(title) LIKE ? OR lower(original_title) LIKE ? OR lower(series_title) LIKE ? OR lower(series_original_title) LIKE ? OR lower(path) LIKE ?)`)
		like := "%" + needle + "%"
		args = append(args, like, like, like, like, like)
	}
	typeFilter := normalizeMediaType(mediaType)
	if typeFilter != "" {
		conditions = append(conditions, `media_type = ?`)
		args = append(args, typeFilter)
	}
	dirFilter := strings.TrimSpace(directory)
	if dirFilter != "" {
		normalized := strings.ToLower(strings.ReplaceAll(strings.TrimRight(dirFilter, "/\\"), "\\", "/"))
		conditions = append(conditions, `(lower(path) LIKE ? OR lower(replace(path, '\', '/')) LIKE ?)`)
		args = append(args, strings.ToLower(strings.TrimRight(dirFilter, "/\\"))+"%", normalized+"%")
	}
	if len(conditions) > 0 {
		baseQuery += ` WHERE ` + strings.Join(conditions, " AND ")
	}

	countQuery := `SELECT COUNT(1) FROM videos`
	if len(conditions) > 0 {
		countQuery += ` WHERE ` + strings.Join(conditions, " AND ")
	}
	total, err := s.countByQuery(countQuery, args)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	baseQuery += " " + s.buildVideoOrderBy(sortBy, sortOrder) + ` LIMIT ? OFFSET ?`
	args = append(args, pageSize, offset)

	rows, err := s.query(baseQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]domain.Video, 0, 64)
	for rows.Next() {
		video, err := scanVideoRow(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, video)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	// Batch-load subtitles after the main rows cursor is closed to avoid
	// single-connection SQLite deadlocks.
	if err := s.attachSubtitles(out); err != nil {
		return nil, 0, err
	}

	return out, total, nil
}

func (s *Store) GetVideo(videoID string) (domain.Video, bool, error) {
	row := s.queryRow(
		`SELECT id, path, directory, file_name, title, original_title, year, imdb_id, tmdb_id, media_type, metadata_source, series_title, series_original_title, series_imdb_id, series_tmdb_id, poster_path, updated_at FROM videos WHERE id = ?`,
		videoID,
	)

	var (
		video      domain.Video
		posterPath string
		updatedRaw string
	)
	err := row.Scan(
		&video.ID,
		&video.Path,
		&video.Directory,
		&video.FileName,
		&video.Title,
		&video.OriginalTitle,
		&video.Year,
		&video.ImdbID,
		&video.TmdbID,
		&video.MediaType,
		&video.MetadataSource,
		&video.SeriesTitle,
		&video.SeriesOriginalTitle,
		&video.SeriesImdbID,
		&video.SeriesTmdbID,
		&posterPath,
		&updatedRaw,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Video{}, false, nil
	}
	if err != nil {
		return domain.Video{}, false, err
	}
	video.PosterPath = posterPath
	video.UpdatedAt = parseTimeOrNow(updatedRaw)

	subs, err := s.listSubtitlesByVideoID(video.ID)
	if err != nil {
		return domain.Video{}, false, err
	}
	video.Subtitles = subs
	return video, true, nil
}

func (s *Store) UpdateVideoSubtitles(videoID string, subtitles []domain.Subtitle, updatedAt time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	res, err := s.execTx(tx, `UPDATE videos SET updated_at = ? WHERE id = ?`, updatedAt.UTC().Format(time.RFC3339Nano), videoID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}

	existingSubtitleSources, err := s.loadSubtitleSourcesTx(tx, videoID)
	if err != nil {
		return err
	}
	if _, err = s.execTx(tx, `DELETE FROM subtitles WHERE video_id = ?`, videoID); err != nil {
		return err
	}
	for _, sub := range subtitles {
		sub = mergeSubtitleSource(sub, existingSubtitleSources)
		_, err = s.execTx(
			tx,
			`INSERT INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at, source, source_detail)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sub.ID,
			videoID,
			sub.Path,
			sub.FileName,
			sub.Language,
			sub.Format,
			sub.Size,
			sub.ModTime.UTC().Format(time.RFC3339Nano),
			updatedAt.UTC().Format(time.RFC3339Nano),
			sub.Source,
			sub.SourceDetail,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) ListVideoDirectories(mediaType string) ([]string, error) {
	query := `SELECT DISTINCT directory FROM videos`
	var args []any
	if t := normalizeMediaType(mediaType); t != "" {
		query += ` WHERE media_type = ?`
		args = append(args, t)
	}

	rows, err := s.query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, 32)
	for rows.Next() {
		var dir string
		if err := rows.Scan(&dir); err != nil {
			return nil, err
		}
		out = append(out, dir)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) countVideos() (int, error) {
	row := s.queryRow(`SELECT COUNT(1) FROM videos`)
	var count int
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) countByQuery(query string, args []any) (int, error) {
	row := s.queryRow(query, args...)
	var count int
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) listSubtitlesByVideoID(videoID string) ([]domain.Subtitle, error) {
	rows, err := s.query(
		`SELECT id, path, file_name, language, format, size, mod_time, source, source_detail
FROM subtitles WHERE video_id = ? ORDER BY file_name ASC`,
		videoID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Subtitle, 0, 8)
	for rows.Next() {
		var (
			sub      domain.Subtitle
			modValue string
		)
		if err := rows.Scan(
			&sub.ID,
			&sub.Path,
			&sub.FileName,
			&sub.Language,
			&sub.Format,
			&sub.Size,
			&modValue,
			&sub.Source,
			&sub.SourceDetail,
		); err != nil {
			return nil, err
		}
		sub.ModTime = parseTimeOrNow(modValue)
		sub = normalizeSubtitleSource(sub)
		out = append(out, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) attachSubtitles(videos []domain.Video) error {
	if len(videos) == 0 {
		return nil
	}

	placeholders := make([]string, len(videos))
	args := make([]any, len(videos))
	indexByID := make(map[string]int, len(videos))
	for i, v := range videos {
		placeholders[i] = "?"
		args[i] = v.ID
		indexByID[v.ID] = i
		videos[i].Subtitles = []domain.Subtitle{}
	}

	query := `SELECT video_id, id, path, file_name, language, format, size, mod_time, source, source_detail
FROM subtitles WHERE video_id IN (` + strings.Join(placeholders, ",") + `) ORDER BY file_name ASC`

	rows, err := s.query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			videoID  string
			sub      domain.Subtitle
			modValue string
		)
		if err := rows.Scan(
			&videoID,
			&sub.ID,
			&sub.Path,
			&sub.FileName,
			&sub.Language,
			&sub.Format,
			&sub.Size,
			&modValue,
			&sub.Source,
			&sub.SourceDetail,
		); err != nil {
			return err
		}
		sub.ModTime = parseTimeOrNow(modValue)
		sub = normalizeSubtitleSource(sub)
		idx, ok := indexByID[videoID]
		if !ok {
			continue
		}
		videos[idx].Subtitles = append(videos[idx].Subtitles, sub)
	}
	return rows.Err()
}

func (s *Store) loadSubtitleSourcesTx(tx *sql.Tx, videoID string) (map[string]subtitleSourceInfo, error) {
	query := `SELECT path, source, source_detail FROM subtitles`
	args := []any{}
	if strings.TrimSpace(videoID) != "" {
		query += ` WHERE video_id = ?`
		args = append(args, videoID)
	}

	rows, err := s.queryTx(tx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]subtitleSourceInfo, 32)
	for rows.Next() {
		var (
			pathValue string
			info      subtitleSourceInfo
		)
		if err := rows.Scan(&pathValue, &info.Source, &info.SourceDetail); err != nil {
			return nil, err
		}
		info.Source = normalizeSubtitleSourceValue(info.Source)
		info.SourceDetail = strings.TrimSpace(info.SourceDetail)
		out[subtitlePathKey(pathValue)] = info
	}
	return out, rows.Err()
}

func mergeSubtitleSource(sub domain.Subtitle, existing map[string]subtitleSourceInfo) domain.Subtitle {
	source := strings.TrimSpace(sub.Source)
	detail := strings.TrimSpace(sub.SourceDetail)
	if source == "" || (normalizeSubtitleSourceValue(source) == domain.SubtitleSourceDirectory && detail == "") {
		if info, ok := existing[subtitlePathKey(sub.Path)]; ok {
			sub.Source = info.Source
			sub.SourceDetail = info.SourceDetail
			return normalizeSubtitleSource(sub)
		}
	}
	return normalizeSubtitleSource(sub)
}

func normalizeSubtitleSource(sub domain.Subtitle) domain.Subtitle {
	sub.Source = normalizeSubtitleSourceValue(sub.Source)
	sub.SourceDetail = strings.TrimSpace(sub.SourceDetail)
	return sub
}

func normalizeSubtitleSourceValue(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case domain.SubtitleSourceUpload:
		return domain.SubtitleSourceUpload
	case domain.SubtitleSourceGenerated:
		return domain.SubtitleSourceGenerated
	case domain.SubtitleSourceDownload:
		return domain.SubtitleSourceDownload
	default:
		return domain.SubtitleSourceDirectory
	}
}

func subtitlePathKey(pathValue string) string {
	normalized := filepath.Clean(strings.TrimSpace(pathValue))
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	return strings.ToLower(normalized)
}
func normalizeMediaType(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case domain.MediaTypeMovie:
		return domain.MediaTypeMovie
	case domain.MediaTypeTV:
		return domain.MediaTypeTV
	default:
		return ""
	}
}

func normalizeSortBy(sortBy string) string {
	switch strings.ToLower(strings.TrimSpace(sortBy)) {
	case "year":
		return "year"
	case "title":
		return "title"
	case "updatedat", "updated_at":
		return "updatedAt"
	case "subtitlecount", "subtitle_count":
		return "subtitleCount"
	default:
		return ""
	}
}

func normalizeSortOrder(sortOrder string) string {
	switch strings.ToLower(strings.TrimSpace(sortOrder)) {
	case "asc":
		return "asc"
	default:
		return "desc"
	}
}

func sortDirection(sortOrder string) string {
	if normalizeSortOrder(sortOrder) == "asc" {
		return "ASC"
	}
	return "DESC"
}

func (s *Store) buildVideoOrderBy(sortBy string, sortOrder string) string {
	dir := sortDirection(sortOrder)
	switch normalizeSortBy(sortBy) {
	case "title":
		return `ORDER BY title_sort_key ` + dir + `, lower(title) ` + dir + `, path ASC`
	case "updatedAt":
		return `ORDER BY updated_at ` + dir + `, title_sort_key ASC, path ASC`
	case "subtitleCount":
		return `ORDER BY (SELECT COUNT(1) FROM subtitles s WHERE s.video_id = videos.id) ` + dir + `, title_sort_key ASC, path ASC`
	case "year":
		emptyExpr := `CASE WHEN trim(ifnull(year, '')) = '' THEN 1 ELSE 0 END`
		yearExpr := `CAST(year AS INTEGER)`
		if s.dialect == dialectPostgres {
			emptyExpr = `CASE WHEN trim(coalesce(year, '')) = '' THEN 1 ELSE 0 END`
			yearExpr = `CASE WHEN trim(coalesce(year, '')) ~ '^[0-9]+$' THEN CAST(year AS INTEGER) ELSE 0 END`
		}
		return `ORDER BY ` + emptyExpr + ` ASC, ` + yearExpr + ` ` + dir + `, title_sort_key ASC, path ASC`
	default:
		return `ORDER BY title_sort_key ASC, path ASC`
	}
}

func defaultMediaType(mediaType string) string {
	normalized := normalizeMediaType(mediaType)
	if normalized == "" {
		return domain.MediaTypeMovie
	}
	return normalized
}

func scanVideoRow(rows *sql.Rows) (domain.Video, error) {
	var (
		video      domain.Video
		posterPath string
		updatedRaw string
	)
	if err := rows.Scan(
		&video.ID,
		&video.Path,
		&video.Directory,
		&video.FileName,
		&video.Title,
		&video.OriginalTitle,
		&video.Year,
		&video.ImdbID,
		&video.TmdbID,
		&video.MediaType,
		&video.MetadataSource,
		&video.SeriesTitle,
		&video.SeriesOriginalTitle,
		&video.SeriesImdbID,
		&video.SeriesTmdbID,
		&posterPath,
		&updatedRaw,
	); err != nil {
		return domain.Video{}, err
	}
	video.PosterPath = posterPath
	video.UpdatedAt = parseTimeOrNow(updatedRaw)
	return video, nil
}

func parseTimeOrNow(raw string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Now().UTC()
	}
	return t
}
