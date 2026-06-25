package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"subtitle-ui/backend/internal/domain"
)

const migrationV1 = `
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  directory TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  year TEXT NOT NULL DEFAULT '',
  metadata_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subtitles (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'und',
  format TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  mod_time TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subtitles_video_id ON subtitles(video_id);
CREATE INDEX IF NOT EXISTS idx_subtitles_path ON subtitles(path);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  video_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  video_id TEXT NOT NULL,
  target_path TEXT NOT NULL DEFAULT '',
  backup_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_timestamp ON operation_logs(timestamp);
`

const migrationV2 = `
ALTER TABLE videos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'movie';
CREATE INDEX IF NOT EXISTS idx_videos_media_type ON videos(media_type);
`

const migrationV3 = `
ALTER TABLE videos ADD COLUMN poster_path TEXT NOT NULL DEFAULT '';
`

const migrationV4 = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const migrationV5AddSource = `
ALTER TABLE subtitles ADD COLUMN source TEXT NOT NULL DEFAULT 'directory';
`

const migrationV5AddSourceDetail = `
ALTER TABLE subtitles ADD COLUMN source_detail TEXT NOT NULL DEFAULT '';
`

type Store struct {
	db *sql.DB
}

type subtitleSourceInfo struct {
	Source       string
	SourceDetail string
}

func Open(dbPath string) (*Store, error) {
	absPath, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", absPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
		_ = db.Close()
		return nil, err
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) SaveScanResult(videos []domain.Video, startedAt time.Time, finishedAt time.Time, scanErr string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	_, err = tx.Exec(
		`INSERT INTO scan_runs(started_at, finished_at, video_count, error) VALUES(?, ?, ?, ?)`,
		startedAt.UTC().Format(time.RFC3339Nano),
		finishedAt.UTC().Format(time.RFC3339Nano),
		len(videos),
		scanErr,
	)
	if err != nil {
		return err
	}

	if scanErr == "" || len(videos) > 0 {
		existingSubtitleSources, err := s.loadSubtitleSourcesTx(tx, "")
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`DELETE FROM subtitles`); err != nil {
			return err
		}
		if _, err = tx.Exec(`DELETE FROM videos`); err != nil {
			return err
		}

		for _, video := range videos {
			_, err = tx.Exec(
				`INSERT OR REPLACE INTO videos(id, path, directory, file_name, title, year, media_type, metadata_source, poster_path, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				video.ID,
				video.Path,
				video.Directory,
				video.FileName,
				video.Title,
				video.Year,
				defaultMediaType(video.MediaType),
				video.MetadataSource,
				video.PosterPath,
				video.UpdatedAt.UTC().Format(time.RFC3339Nano),
			)
			if err != nil {
				return err
			}

			for _, sub := range video.Subtitles {
				sub = mergeSubtitleSource(sub, existingSubtitleSources)
				_, err = tx.Exec(
					`INSERT OR REPLACE INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at, source, source_detail)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					sub.ID,
					video.ID,
					sub.Path,
					sub.FileName,
					sub.Language,
					sub.Format,
					sub.Size,
					sub.ModTime.UTC().Format(time.RFC3339Nano),
					video.UpdatedAt.UTC().Format(time.RFC3339Nano),
					sub.Source,
					sub.SourceDetail,
				)
				if err != nil {
					return err
				}
			}
		}
	}

	return tx.Commit()
}

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

	baseQuery := `SELECT id, path, directory, file_name, title, year, media_type, metadata_source, poster_path, updated_at FROM videos`
	args := []any{}
	conditions := make([]string, 0, 2)

	needle := strings.TrimSpace(strings.ToLower(query))
	if needle != "" {
		conditions = append(conditions, `(lower(title) LIKE ? OR lower(path) LIKE ?)`)
		like := "%" + needle + "%"
		args = append(args, like, like)
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
	baseQuery += " " + buildVideoOrderBy(sortBy, sortOrder) + ` LIMIT ? OFFSET ?`
	args = append(args, pageSize, offset)

	rows, err := s.db.Query(baseQuery, args...)
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
	row := s.db.QueryRow(
		`SELECT id, path, directory, file_name, title, year, media_type, metadata_source, poster_path, updated_at FROM videos WHERE id = ?`,
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
		&video.Year,
		&video.MediaType,
		&video.MetadataSource,
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

	res, err := tx.Exec(`UPDATE videos SET updated_at = ? WHERE id = ?`, updatedAt.UTC().Format(time.RFC3339Nano), videoID)
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
	if _, err = tx.Exec(`DELETE FROM subtitles WHERE video_id = ?`, videoID); err != nil {
		return err
	}
	for _, sub := range subtitles {
		sub = mergeSubtitleSource(sub, existingSubtitleSources)
		_, err = tx.Exec(
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

func (s *Store) AppendLog(log domain.OperationLog) error {
	_, err := s.db.Exec(
		`INSERT INTO operation_logs(id, timestamp, action, video_id, target_path, backup_path, status, message)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
		log.ID,
		log.Timestamp.UTC().Format(time.RFC3339Nano),
		log.Action,
		log.VideoID,
		log.TargetPath,
		log.BackupPath,
		log.Status,
		log.Message,
	)
	return err
}

func (s *Store) ListLogs(page int, pageSize int) ([]domain.OperationLog, int, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 8
	}
	if pageSize > 200 {
		pageSize = 200
	}

	total, err := s.countByQuery(`SELECT COUNT(1) FROM operation_logs`, nil)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	rows, err := s.db.Query(
		`SELECT id, timestamp, action, video_id, target_path, backup_path, status, message
FROM operation_logs ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
		pageSize,
		offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]domain.OperationLog, 0, pageSize)
	for rows.Next() {
		var (
			log       domain.OperationLog
			timeValue string
		)
		if err := rows.Scan(
			&log.ID,
			&timeValue,
			&log.Action,
			&log.VideoID,
			&log.TargetPath,
			&log.BackupPath,
			&log.Status,
			&log.Message,
		); err != nil {
			return nil, 0, err
		}
		log.Timestamp = parseTimeOrNow(timeValue)
		out = append(out, log)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (s *Store) ClearLogs() error {
	_, err := s.db.Exec(`DELETE FROM operation_logs`)
	return err
}

func (s *Store) GetAppSettings(keys []string) (map[string]domain.AppSetting, error) {
	out := make(map[string]domain.AppSetting, len(keys))
	if len(keys) == 0 {
		return out, nil
	}

	placeholders := make([]string, len(keys))
	args := make([]any, len(keys))
	for i, key := range keys {
		placeholders[i] = "?"
		args[i] = key
	}

	rows, err := s.db.Query(
		`SELECT key, value, updated_at FROM app_settings WHERE key IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			setting    domain.AppSetting
			updatedRaw string
		)
		if err := rows.Scan(&setting.Key, &setting.Value, &updatedRaw); err != nil {
			return nil, err
		}
		setting.UpdatedAt = parseTimeOrNow(updatedRaw)
		out[setting.Key] = setting
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) SetAppSettings(values map[string]string, updatedAt time.Time) error {
	if len(values) == 0 {
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

	updatedValue := updatedAt.UTC().Format(time.RFC3339Nano)
	for key, value := range values {
		if _, err = tx.Exec(
			`INSERT INTO app_settings(key, value, updated_at) VALUES(?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			key,
			value,
			updatedValue,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) GetLatestScanStatus() (domain.ScanStatus, error) {
	status := domain.ScanStatus{}
	row := s.db.QueryRow(
		`SELECT started_at, finished_at, video_count, error
FROM scan_runs ORDER BY id DESC LIMIT 1`,
	)

	var (
		startedRaw  string
		finishedRaw string
		videoCount  int
		scanErr     string
	)
	err := row.Scan(&startedRaw, &finishedRaw, &videoCount, &scanErr)
	if errors.Is(err, sql.ErrNoRows) {
		count, countErr := s.countVideos()
		if countErr != nil {
			return status, countErr
		}
		status.VideoCount = count
		return status, nil
	}
	if err != nil {
		return status, err
	}

	started := parseTimeOrNow(startedRaw)
	finished := parseTimeOrNow(finishedRaw)
	status.LastStartedAt = &started
	status.LastFinishedAt = &finished
	status.VideoCount = videoCount
	status.Error = scanErr
	return status, nil
}

func (s *Store) ListVideoDirectories(mediaType string) ([]string, error) {
	query := `SELECT DISTINCT directory FROM videos`
	var args []any
	if t := normalizeMediaType(mediaType); t != "" {
		query += ` WHERE media_type = ?`
		args = append(args, t)
	}

	rows, err := s.db.Query(query, args...)
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
	row := s.db.QueryRow(`SELECT COUNT(1) FROM videos`)
	var count int
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) countByQuery(query string, args []any) (int, error) {
	row := s.db.QueryRow(query, args...)
	var count int
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Store) listSubtitlesByVideoID(videoID string) ([]domain.Subtitle, error) {
	rows, err := s.db.Query(
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

	rows, err := s.db.Query(query, args...)
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

	rows, err := tx.Query(query, args...)
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
	default:
		return domain.SubtitleSourceDirectory
	}
}

func subtitlePathKey(pathValue string) string {
	normalized := filepath.Clean(strings.TrimSpace(pathValue))
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	return strings.ToLower(normalized)
}

func (s *Store) backfillSubtitleSources() error {
	type backfillInfo struct {
		targetPath   string
		source       string
		sourceDetail string
	}

	rows, err := s.db.Query(
		`SELECT target_path, action, message
FROM operation_logs
WHERE status = 'ok'
  AND action IN ('upload', 'replace', 'convert')
  AND trim(target_path) != ''
ORDER BY timestamp ASC`,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	latestByPath := make(map[string]backfillInfo, 32)
	for rows.Next() {
		var targetPath, action, message string
		if err := rows.Scan(&targetPath, &action, &message); err != nil {
			return err
		}
		info := backfillInfo{targetPath: targetPath}
		switch action {
		case "convert":
			info.source = domain.SubtitleSourceGenerated
			info.sourceDetail = strings.TrimSpace(strings.TrimPrefix(message, "generated from "))
		default:
			info.source = domain.SubtitleSourceUpload
			info.sourceDetail = filepath.Base(targetPath)
		}
		latestByPath[subtitlePathKey(targetPath)] = info
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, info := range latestByPath {
		if info.sourceDetail == "" || info.sourceDetail == "." {
			info.sourceDetail = filepath.Base(info.targetPath)
		}
		if _, err := s.db.Exec(
			`UPDATE subtitles SET source = ?, source_detail = ? WHERE lower(path) = lower(?)`,
			info.source,
			info.sourceDetail,
			info.targetPath,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`); err != nil {
		return err
	}

	applied, err := s.isMigrationApplied(1)
	if err != nil {
		return err
	}
	if !applied {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		defer func() {
			if err != nil {
				_ = tx.Rollback()
			}
		}()

		if _, err = tx.Exec(migrationV1); err != nil {
			return fmt.Errorf("apply migration v1: %w", err)
		}
		if _, err = tx.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, 1, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}

	applied, err = s.isMigrationApplied(2)
	if err != nil {
		return err
	}
	if !applied {
		hasMediaType, err := s.hasColumn("videos", "media_type")
		if err != nil {
			return err
		}
		if !hasMediaType {
			if _, err := s.db.Exec(migrationV2); err != nil {
				return fmt.Errorf("apply migration v2: %w", err)
			}
		}
		if _, err = s.db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, 2, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
	}

	applied, err = s.isMigrationApplied(3)
	if err != nil {
		return err
	}
	if !applied {
		hasPosterPath, err := s.hasColumn("videos", "poster_path")
		if err != nil {
			return err
		}
		if !hasPosterPath {
			if _, err := s.db.Exec(migrationV3); err != nil {
				return fmt.Errorf("apply migration v3: %w", err)
			}
		}
		if _, err := s.db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, 3, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
	}

	applied, err = s.isMigrationApplied(4)
	if err != nil {
		return err
	}
	if !applied {
		if _, err := s.db.Exec(migrationV4); err != nil {
			return fmt.Errorf("apply migration v4: %w", err)
		}
		if _, err := s.db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, 4, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
	}

	applied, err = s.isMigrationApplied(5)
	if err != nil {
		return err
	}
	if !applied {
		hasSource, err := s.hasColumn("subtitles", "source")
		if err != nil {
			return err
		}
		if !hasSource {
			if _, err := s.db.Exec(migrationV5AddSource); err != nil {
				return fmt.Errorf("apply migration v5 source: %w", err)
			}
		}
		hasSourceDetail, err := s.hasColumn("subtitles", "source_detail")
		if err != nil {
			return err
		}
		if !hasSourceDetail {
			if _, err := s.db.Exec(migrationV5AddSourceDetail); err != nil {
				return fmt.Errorf("apply migration v5 source_detail: %w", err)
			}
		}
		if err := s.backfillSubtitleSources(); err != nil {
			return fmt.Errorf("backfill migration v5 subtitle sources: %w", err)
		}
		if _, err := s.db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, 5, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) isMigrationApplied(version int) (bool, error) {
	row := s.db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, version)
	var count int
	if err := row.Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Store) hasColumn(tableName string, columnName string) (bool, error) {
	rows, err := s.db.Query(`PRAGMA table_info(` + tableName + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			name       string
			colType    string
			notNull    int
			defaultV   any
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultV, &primaryKey); err != nil {
			return false, err
		}
		if strings.EqualFold(name, columnName) {
			return true, nil
		}
	}
	return false, rows.Err()
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

func buildVideoOrderBy(sortBy string, sortOrder string) string {
	if normalizeSortBy(sortBy) == "year" {
		if normalizeSortOrder(sortOrder) == "asc" {
			return `ORDER BY CASE WHEN trim(ifnull(year, '')) = '' THEN 1 ELSE 0 END ASC, CAST(year AS INTEGER) ASC, title ASC, path ASC`
		}
		return `ORDER BY CASE WHEN trim(ifnull(year, '')) = '' THEN 1 ELSE 0 END ASC, CAST(year AS INTEGER) DESC, title ASC, path ASC`
	}
	return `ORDER BY title ASC, path ASC`
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
		&video.Year,
		&video.MediaType,
		&video.MetadataSource,
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
