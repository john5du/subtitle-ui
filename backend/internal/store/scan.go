package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/textsort"
)

// SaveScanResult persists a scan. replaceScopes limits which existing rows are
// removed: only videos whose path is under one of those directories are deleted
// when missing from the result. An empty replaceScopes list means a
// full-library reconcile (delete any video not present in videos).
//
// All videos in the slice are upserted. Prefer SaveScanReconcile when only a
// subset of found videos were rebuilt.
func (s *Store) SaveScanResult(videos []domain.Video, startedAt time.Time, finishedAt time.Time, scanErr string, replaceScopes []string) error {
	return s.SaveScanReconcile(videos, videos, startedAt, finishedAt, scanErr, replaceScopes)
}

// SaveScanReconcile reconciles the library with a scan:
//   - found defines the complete set of video paths still present on disk (in scope)
//   - rebuilt are upserted (metadata/subtitles rewritten); skipped found videos are left untouched
//   - videos in scope that are not in found are deleted
//
// When scanErr is non-empty, only the scan_runs row is written — no deletes or upserts.
// Partial scan failures must not wipe half the library (e.g. TV root down while movies scan OK).
func (s *Store) SaveScanReconcile(found []domain.Video, rebuilt []domain.Video, startedAt time.Time, finishedAt time.Time, scanErr string, replaceScopes []string) error {
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
		len(found),
		scanErr,
	)
	if err != nil {
		return err
	}

	// Never mutate the library when the scan reported an error: found/rebuilt may be incomplete.
	if strings.TrimSpace(scanErr) != "" {
		return tx.Commit()
	}

	{
		foundPaths := make(map[string]struct{}, len(found))
		for _, video := range found {
			foundPaths[normalizeScanPath(video.Path)] = struct{}{}
		}

		if err = s.deleteMissingVideosForScanScopesTx(tx, replaceScopes, foundPaths); err != nil {
			return err
		}

		for _, video := range rebuilt {
			existingSubtitleSources, loadErr := s.loadSubtitleSourcesTx(tx, video.ID)
			if loadErr != nil {
				return loadErr
			}

			fileModTime := ""
			if !video.FileModTime.IsZero() {
				fileModTime = video.FileModTime.UTC().Format(time.RFC3339Nano)
			}

			_, err = s.execTx(
				tx,
				s.insertPrefix()+` INTO videos(id, path, directory, file_name, title, original_title, year, imdb_id, tmdb_id, media_type, metadata_source, series_title, series_original_title, series_imdb_id, series_tmdb_id, poster_path, file_size, file_mod_time, scan_fingerprint, updated_at, title_sort_key)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`+s.videoUpsertSuffix(),
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
				video.FileSize,
				fileModTime,
				video.ScanFingerprint,
				video.UpdatedAt.UTC().Format(time.RFC3339Nano),
				textsort.SortKey(video.Title),
			)
			if err != nil {
				return err
			}

			if _, err = s.execTx(tx, `DELETE FROM subtitles WHERE video_id = ?`, video.ID); err != nil {
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

func (s *Store) deleteMissingVideosForScanScopesTx(tx *sql.Tx, replaceScopes []string, foundPaths map[string]struct{}) error {
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
		if len(replaceScopes) > 0 && !pathUnderAnyScope(path, replaceScopes) {
			continue
		}
		if _, ok := foundPaths[normalizeScanPath(path)]; ok {
			continue
		}
		ids = append(ids, id)
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
