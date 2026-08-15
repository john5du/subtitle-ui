package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

// RollbackOperation restores state for a successful prior operation log.
func (s *Service) RollbackOperation(opID string) (domain.RollbackResult, error) {
	opID = strings.TrimSpace(opID)
	if opID == "" {
		return domain.RollbackResult{}, fmt.Errorf("%w: missing opId", ErrBadRequest)
	}
	log, err := s.store.GetLog(opID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.RollbackResult{}, ErrNotFound
		}
		return domain.RollbackResult{}, err
	}
	if log.Status != "ok" {
		return domain.RollbackResult{}, fmt.Errorf("%w: only successful operations can be rolled back (status=%s)", ErrBadRequest, log.Status)
	}
	if log.Action == "rollback" {
		return domain.RollbackResult{}, fmt.Errorf("%w: cannot rollback a rollback entry", ErrBadRequest)
	}

	// Serialize with other subtitle disk+DB mutations for this video.
	videoID := strings.TrimSpace(log.VideoID)
	if videoID != "" && videoID != systemOperationVideoID {
		mu := s.lockVideo(videoID)
		mu.Lock()
		defer mu.Unlock()
	}

	meta := parseOpMeta(log.Meta)
	result := domain.RollbackResult{
		OpID:       log.ID,
		Action:     log.Action,
		BackupPath: log.BackupPath,
	}

	switch log.Action {
	case "delete":
		if err := s.rollbackFromBackupTo(log, log.TargetPath); err != nil {
			return result, err
		}
		result.RestoredPath = log.TargetPath
		result.Message = "restored deleted subtitle from backup"

	case "offset":
		if err := s.rollbackFromBackupTo(log, log.TargetPath); err != nil {
			return result, err
		}
		result.RestoredPath = log.TargetPath
		result.Message = "restored file content from backup"

	case "replace", "download_replace":
		fromPath, toPath := resolveReplacePaths(log, meta)
		if err := s.rollbackFromBackupTo(log, fromPath); err != nil {
			return result, err
		}
		if toPath != "" && toPath != fromPath && fileExists(toPath) {
			if err := s.ensureWithinRoots(toPath); err != nil {
				return result, err
			}
			if err := os.Remove(toPath); err != nil {
				return result, fmt.Errorf("remove replaced path after rollback: %w", err)
			}
			result.RemovedPath = toPath
		}
		result.RestoredPath = fromPath
		result.Message = "restored replaced subtitle from backup"

	case "normalize":
		fromPath, toPath := resolveNormalizePaths(log, meta)
		if log.BackupPath == "" || !fileExists(log.BackupPath) {
			return result, fmt.Errorf("%w: backup missing for normalize rollback", ErrNotFound)
		}
		if err := s.ensureWithinRoots(log.BackupPath); err != nil {
			return result, err
		}
		if fromPath == "" {
			return result, fmt.Errorf("%w: missing fromPath for normalize rollback", ErrBadRequest)
		}
		if err := s.ensureWithinRoots(fromPath); err != nil {
			return result, err
		}
		if err := subtitle.RestoreFile(log.BackupPath, fromPath); err != nil {
			return result, err
		}
		if toPath != "" && toPath != fromPath && fileExists(toPath) {
			if err := s.ensureWithinRoots(toPath); err != nil {
				return result, err
			}
			if err := os.Remove(toPath); err != nil {
				return result, fmt.Errorf("remove normalized path after rollback: %w", err)
			}
			result.RemovedPath = toPath
		}
		result.RestoredPath = fromPath
		result.Message = "restored normalize rename from backup"

	case "upload", "download":
		if log.TargetPath == "" {
			return result, fmt.Errorf("%w: missing target_path", ErrBadRequest)
		}
		if err := s.ensureWithinRoots(log.TargetPath); err != nil {
			return result, err
		}
		if fileExists(log.TargetPath) {
			if err := os.Remove(log.TargetPath); err != nil {
				return result, err
			}
			result.RemovedPath = log.TargetPath
		}
		// Legacy/partial replace logs under upload/download with backup: restore original.
		if log.BackupPath != "" && fileExists(log.BackupPath) {
			restoreTo := stringMeta(meta, "fromPath")
			if restoreTo == "" {
				restoreTo = subtitle.SourcePathFromBackup(log.BackupPath)
			}
			if restoreTo == "" {
				restoreTo = log.TargetPath
			}
			if err := s.rollbackFromBackupTo(log, restoreTo); err != nil {
				return result, err
			}
			result.RestoredPath = restoreTo
		}
		result.Message = "removed installed subtitle (rollback create)"

	case "convert":
		gen := stringMeta(meta, "generatedPath")
		if gen == "" {
			if strings.EqualFold(filepath.Ext(log.TargetPath), ".srt") {
				gen = strings.TrimSuffix(log.TargetPath, filepath.Ext(log.TargetPath)) + ".ass"
			} else {
				gen = log.TargetPath
			}
		}
		if gen == "" {
			return result, fmt.Errorf("%w: cannot resolve generated path for convert rollback", ErrBadRequest)
		}
		if err := s.ensureWithinRoots(gen); err != nil {
			return result, err
		}
		if fileExists(gen) {
			if err := os.Remove(gen); err != nil {
				return result, err
			}
			result.RemovedPath = gen
		}
		result.Message = "removed converted ASS"

	default:
		return result, fmt.Errorf("%w: rollback not supported for action %q", ErrBadRequest, log.Action)
	}

	if videoID != "" && videoID != systemOperationVideoID {
		if _, _, err := s.refreshVideoSubtitles(videoID, result.RestoredPath, nil); err != nil {
			s.recordOpEx(OpRecord{
				Action:     "rollback",
				VideoID:    log.VideoID,
				TargetPath: log.TargetPath,
				BackupPath: log.BackupPath,
				Status:     "error",
				Message:    fmt.Sprintf("files restored but refresh failed: %v", err),
				Source:     domain.OpSourceSystem,
				Meta: map[string]any{
					"refOpId":      log.ID,
					"refAction":    log.Action,
					"restoredPath": result.RestoredPath,
					"removedPath":  result.RemovedPath,
				},
			})
			return result, fmt.Errorf("rollback files applied but subtitle refresh failed: %w", err)
		}
		s.notifyJellyfinAfterSubtitleChange(videoID)
	}

	result.OK = true
	rollbackID := s.recordOpEx(OpRecord{
		Action:     "rollback",
		VideoID:    log.VideoID,
		TargetPath: log.TargetPath,
		BackupPath: log.BackupPath,
		Status:     "ok",
		Message:    fmt.Sprintf("ref=%s action=%s", log.ID, log.Action),
		Source:     domain.OpSourceSystem,
		Meta: map[string]any{
			"refOpId":      log.ID,
			"refAction":    log.Action,
			"restoredPath": result.RestoredPath,
			"removedPath":  result.RemovedPath,
		},
	})
	result.RollbackLogID = rollbackID
	return result, nil
}

// resolveReplacePaths picks restore (from) and optional remove (to) paths for replace logs.
func resolveReplacePaths(log domain.OperationLog, meta map[string]any) (fromPath, toPath string) {
	fromPath = stringMeta(meta, "fromPath")
	toPath = stringMeta(meta, "toPath")
	if toPath == "" {
		toPath = log.TargetPath
	}
	if fromPath == "" && log.BackupPath != "" {
		fromPath = subtitle.SourcePathFromBackup(log.BackupPath)
	}
	if fromPath == "" {
		fromPath = log.TargetPath
	}
	// When from was inferred from backup and differs from target, target is the post-replace path.
	if toPath == "" {
		toPath = log.TargetPath
	}
	return fromPath, toPath
}

// resolveNormalizePaths picks original and renamed paths for normalize logs.
func resolveNormalizePaths(log domain.OperationLog, meta map[string]any) (fromPath, toPath string) {
	fromPath = stringMeta(meta, "fromPath")
	toPath = stringMeta(meta, "toPath")
	if toPath == "" {
		toPath = stringMeta(meta, "to")
	}
	// New logs: TargetPath is toPath. Old logs without meta: TargetPath is also toPath.
	if toPath == "" {
		toPath = log.TargetPath
	}
	if fromPath == "" && log.BackupPath != "" {
		fromPath = subtitle.SourcePathFromBackup(log.BackupPath)
	}
	if fromPath == "" {
		// Last resort: cannot rename back; restore content onto target only.
		fromPath = log.TargetPath
	}
	return fromPath, toPath
}

func (s *Service) rollbackFromBackupTo(log domain.OperationLog, restorePath string) error {
	if log.BackupPath == "" {
		return fmt.Errorf("%w: no backup_path on operation", ErrBadRequest)
	}
	if !fileExists(log.BackupPath) {
		return fmt.Errorf("%w: backup file missing: %s", ErrNotFound, log.BackupPath)
	}
	if restorePath == "" {
		return fmt.Errorf("%w: missing restore path", ErrBadRequest)
	}
	if err := s.ensureWithinRoots(log.BackupPath); err != nil {
		return err
	}
	if err := s.ensureWithinRoots(restorePath); err != nil {
		return err
	}
	return subtitle.RestoreFile(log.BackupPath, restorePath)
}

func (s *Service) ensureWithinRoots(path string) error {
	if !s.isWithinMediaRoots(path) {
		return ErrUnsafePath
	}
	return nil
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func parseOpMeta(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil
	}
	return m
}

func stringMeta(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}
