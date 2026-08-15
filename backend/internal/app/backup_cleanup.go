package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

// ListSubtitleBackups finds *.bak.* files under media roots (optional video directory scope).
func (s *Service) ListSubtitleBackups(videoID string, olderThanDays int) ([]domain.SubtitleBackupInfo, error) {
	var roots []string
	if videoID = strings.TrimSpace(videoID); videoID != "" {
		video, err := s.GetVideo(videoID)
		if err != nil {
			return nil, err
		}
		roots = []string{video.Directory}
	} else {
		roots = []string{s.cfg.MovieMediaRoot, s.cfg.TVMediaRoot}
	}

	var cutoff time.Time
	if olderThanDays > 0 {
		cutoff = time.Now().UTC().AddDate(0, 0, -olderThanDays)
	}

	out := make([]domain.SubtitleBackupInfo, 0, 32)
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || d == nil || d.IsDir() {
				return nil
			}
			if !subtitle.IsBackupPath(path) {
				return nil
			}
			if !s.isWithinMediaRoots(path) {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			if !cutoff.IsZero() && info.ModTime().UTC().After(cutoff) {
				return nil
			}
			out = append(out, domain.SubtitleBackupInfo{
				Path:       path,
				SourcePath: subtitle.SourcePathFromBackup(path),
				Size:       info.Size(),
				ModTime:    info.ModTime().UTC(),
				VideoID:    videoID,
			})
			return nil
		})
	}
	return out, nil
}

// CleanupSubtitleBackups deletes backup files. dryRun only lists candidates.
// olderThanDays > 0 filters by mtime; paths if non-empty restricts to those paths (must be bak + media root).
func (s *Service) CleanupSubtitleBackups(dryRun bool, olderThanDays int, paths []string) (domain.CleanupBackupsResult, error) {
	result := domain.CleanupBackupsResult{DryRun: dryRun}
	var candidates []string

	if len(paths) > 0 {
		for _, p := range paths {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if !subtitle.IsBackupPath(p) {
				result.Failed = append(result.Failed, domain.CleanupFailure{Path: p, Error: "not a backup path"})
				continue
			}
			if !s.isWithinMediaRoots(p) {
				result.Failed = append(result.Failed, domain.CleanupFailure{Path: p, Error: "outside media roots"})
				continue
			}
			if !fileExists(p) {
				result.Failed = append(result.Failed, domain.CleanupFailure{Path: p, Error: "not found"})
				continue
			}
			if olderThanDays > 0 {
				st, err := os.Stat(p)
				if err != nil {
					result.Failed = append(result.Failed, domain.CleanupFailure{Path: p, Error: err.Error()})
					continue
				}
				cutoff := time.Now().UTC().AddDate(0, 0, -olderThanDays)
				if st.ModTime().UTC().After(cutoff) {
					continue
				}
			}
			candidates = append(candidates, p)
		}
	} else {
		list, err := s.ListSubtitleBackups("", olderThanDays)
		if err != nil {
			return result, err
		}
		for _, b := range list {
			candidates = append(candidates, b.Path)
		}
	}

	if dryRun {
		result.WouldDelete = candidates
		result.Count = len(candidates)
		return result, nil
	}

	for _, p := range candidates {
		if err := os.Remove(p); err != nil {
			result.Failed = append(result.Failed, domain.CleanupFailure{Path: p, Error: err.Error()})
			continue
		}
		result.Deleted = append(result.Deleted, p)
	}
	result.Count = len(result.Deleted)
	s.recordOpEx(OpRecord{
		Action:  "cleanup_backups",
		VideoID: systemOperationVideoID,
		Status:  "ok",
		Message: fmt.Sprintf("deleted=%d failed=%d olderThanDays=%d", result.Count, len(result.Failed), olderThanDays),
		Source:  domain.OpSourceSystem,
		Meta: map[string]any{
			"deleted":       result.Count,
			"failed":        len(result.Failed),
			"olderThanDays": olderThanDays,
		},
	})
	return result, nil
}
