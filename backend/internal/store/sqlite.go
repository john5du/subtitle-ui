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

type Store struct {
	db *sql.DB
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
				_, err = tx.Exec(
					`INSERT OR REPLACE INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					sub.ID,
					video.ID,
					sub.Path,
					sub.FileName,
					sub.Language,
					sub.Format,
					sub.Size,
					sub.ModTime.UTC().Format(time.RFC3339Nano),
					video.UpdatedAt.UTC().Format(time.RFC3339Nano),
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

	// Query subtitles only after closing the main rows cursor to avoid
	// single-connection SQLite deadlocks.
	for i := range out {
		subs, err := s.listSubtitlesByVideoID(out[i].ID)
		if err != nil {
			return nil, 0, err
		}
		out[i].Subtitles = subs
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

	if _, err = tx.Exec(`DELETE FROM subtitles WHERE video_id = ?`, videoID); err != nil {
		return err
	}
	for _, sub := range subtitles {
		_, err = tx.Exec(
			`INSERT INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sub.ID,
			videoID,
			sub.Path,
			sub.FileName,
			sub.Language,
			sub.Format,
			sub.Size,
			sub.ModTime.UTC().Format(time.RFC3339Nano),
			updatedAt.UTC().Format(time.RFC3339Nano),
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

func (s *Store) ListLogs(limit int) ([]domain.OperationLog, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.db.Query(
		`SELECT id, timestamp, action, video_id, target_path, backup_path, status, message
FROM operation_logs ORDER BY timestamp DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.OperationLog, 0, limit)
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
			return nil, err
		}
		log.Timestamp = parseTimeOrNow(timeValue)
		out = append(out, log)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
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
		`SELECT id, path, file_name, language, format, size, mod_time
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
		); err != nil {
			return nil, err
		}
		sub.ModTime = parseTimeOrNow(modValue)
		out = append(out, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
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
	if applied {
		return nil
	}

	hasPosterPath, err := s.hasColumn("videos", "poster_path")
	if err != nil {
		return err
	}
	if !hasPosterPath {
		if _, err := s.db.Exec(migrationV3); err != nil {
			return fmt.Errorf("apply migration v3: %w", err)
		}
	}
	_, err = s.db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, 3, time.Now().UTC().Format(time.RFC3339Nano))
	return err
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
