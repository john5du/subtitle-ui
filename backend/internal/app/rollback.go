package app

import (
	"encoding/json"
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
		return domain.RollbackResult{}, ErrNotFound
	}
	if log.Status != "ok" {
		return domain.RollbackResult{}, fmt.Errorf("%w: only successful operations can be rolled back (status=%s)", ErrBadRequest, log.Status)
	}
	if log.Action == "rollback" {
		return domain.RollbackResult{}, fmt.Errorf("%w: cannot rollback a rollback entry", ErrBadRequest)
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
		result.OK = true
		result.Message = "restored deleted subtitle from backup"

	case "offset":
		if err := s.rollbackFromBackupTo(log, log.TargetPath); err != nil {
			return result, err
		}
		result.RestoredPath = log.TargetPath
		result.OK = true
		result.Message = "restored file content from backup"

	case "replace", "download_replace":
		// Backup holds pre-replace content; restore to fromPath (old path).
		// TargetPath is the post-replace path (may differ on ext/label change).
		fromPath := stringMeta(meta, "fromPath")
		toPath := stringMeta(meta, "toPath")
		if toPath == "" {
			toPath = log.TargetPath
		}
		if fromPath == "" {
			fromPath = log.TargetPath
		}
		if err := s.rollbackFromBackupTo(log, fromPath); err != nil {
			return result, err
		}
		if toPath != "" && toPath != fromPath && fileExists(toPath) {
			if err := s.ensureWithinRoots(toPath); err == nil {
				_ = os.Remove(toPath)
				result.RemovedPath = toPath
			}
		}
		result.RestoredPath = fromPath
		result.OK = true
		result.Message = "restored replaced subtitle from backup"

	case "normalize":
		fromPath := stringMeta(meta, "fromPath")
		toPath := stringMeta(meta, "toPath")
		if fromPath == "" {
			fromPath = log.TargetPath
		}
		if toPath == "" {
			toPath = stringMeta(meta, "to")
		}
		if log.BackupPath == "" || !fileExists(log.BackupPath) {
			return result, fmt.Errorf("%w: backup missing for normalize rollback", ErrNotFound)
		}
		// Prefer restore content to fromPath; remove toPath if different and still present.
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
			if err := s.ensureWithinRoots(toPath); err == nil {
				_ = os.Remove(toPath)
			}
		}
		result.RestoredPath = fromPath
		result.RemovedPath = toPath
		result.OK = true
		result.Message = "restored normalize rename from backup"

	case "upload", "download":
		// New file install: remove target if present.
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
		// If replace left a backup, also restore it to fromPath when known.
		if log.BackupPath != "" && fileExists(log.BackupPath) {
			restoreTo := stringMeta(meta, "fromPath")
			if restoreTo == "" {
				restoreTo = log.TargetPath
			}
			if err := s.rollbackFromBackupTo(log, restoreTo); err == nil {
				result.RestoredPath = restoreTo
			}
		}
		result.OK = true
		result.Message = "removed installed subtitle (rollback create)"

	case "convert":
		// Remove generated ASS; target_path is source srt in some logs — prefer meta generated path.
		gen := stringMeta(meta, "generatedPath")
		if gen == "" {
			// convert log uses existing.Path as target (source); generated is sibling .ass
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
		result.OK = true
		result.Message = "removed converted ASS"

	default:
		return result, fmt.Errorf("%w: rollback not supported for action %q", ErrBadRequest, log.Action)
	}

	videoID := log.VideoID
	if videoID != "" && videoID != systemOperationVideoID {
		_, _, _ = s.refreshVideoSubtitles(videoID, result.RestoredPath, nil)
		s.notifyJellyfinAfterSubtitleChange(videoID)
	}

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

func (s *Service) rollbackFromBackup(log domain.OperationLog) error {
	return s.rollbackFromBackupTo(log, log.TargetPath)
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
