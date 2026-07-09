package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
)

// SaveScanResult persists a scan. replaceScopes limits which existing rows are
// removed: only videos whose path is under one of those directories are deleted
// before the new scan rows are upserted. An empty replaceScopes list means a
// full-library replace (delete all videos/subtitles first).
func (s *Store) SaveScanResult(videos []domain.Video, startedAt time.Time, finishedAt time.Time, scanErr string, replaceScopes []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	_, err = s.execTx(
		tx,
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
		if err = s.deleteVideosForScanScopesTx(tx, replaceScopes); err != nil {
			return err
		}

		for _, video := range videos {
			_, err = s.execTx(
				tx,
				s.insertPrefix()+` INTO videos(id, path, directory, file_name, title, original_title, year, imdb_id, tmdb_id, media_type, metadata_source, series_title, series_original_title, series_imdb_id, series_tmdb_id, poster_path, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`+s.videoUpsertSuffix(),
				video.ID,
				video.Path,
				video.Directory,
				video.FileName,
				video.Title,
				video.OriginalTitle,
				video.Year,
				video.ImdbID,
				video.TmdbID,
				defaultMediaType(video.MediaType),
				video.MetadataSource,
				video.SeriesTitle,
				video.SeriesOriginalTitle,
				video.SeriesImdbID,
				video.SeriesTmdbID,
				video.PosterPath,
				video.UpdatedAt.UTC().Format(time.RFC3339Nano),
			)
			if err != nil {
				return err
			}

			for _, sub := range video.Subtitles {
				sub = mergeSubtitleSource(sub, existingSubtitleSources)
				_, err = s.execTx(
					tx,
					s.insertPrefix()+` INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at, source, source_detail)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`+s.subtitleUpsertSuffix(),
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

func (s *Store) deleteVideosForScanScopesTx(tx *sql.Tx, replaceScopes []string) error {
	if len(replaceScopes) == 0 {
		if _, err := s.execTx(tx, `DELETE FROM subtitles`); err != nil {
			return err
		}
		if _, err := s.execTx(tx, `DELETE FROM videos`); err != nil {
			return err
		}
		return nil
	}

	rows, err := s.queryTx(tx, `SELECT id, path FROM videos`)
	if err != nil {
		return err
	}
	defer rows.Close()

	ids := make([]string, 0, 64)
	for rows.Next() {
		var id, path string
		if err := rows.Scan(&id, &path); err != nil {
			return err
		}
		if pathUnderAnyScope(path, replaceScopes) {
			ids = append(ids, id)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range ids {
		if _, err := s.execTx(tx, `DELETE FROM videos WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

func pathUnderAnyScope(path string, scopes []string) bool {
	normalizedPath := normalizeScanPath(path)
	for _, scope := range scopes {
		normalizedScope := normalizeScanPath(scope)
		if normalizedScope == "" {
			continue
		}
		if normalizedPath == normalizedScope {
			return true
		}
		if strings.HasPrefix(normalizedPath, normalizedScope+"/") {
			return true
		}
	}
	return false
}

func normalizeScanPath(path string) string {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	cleaned = strings.ReplaceAll(cleaned, "\\", "/")
	return strings.TrimRight(cleaned, "/")
}

func (s *Store) GetLatestScanStatus() (domain.ScanStatus, error) {
	status := domain.ScanStatus{}
	row := s.queryRow(
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
