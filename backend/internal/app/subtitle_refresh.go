package app

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/idhash"
	"subtitle-ui/backend/internal/subtitle"
)

func (s *Service) refreshVideoSubtitles(videoID string, targetPath string, sourceOverrides map[string]subtitleSourceOverride) (domain.Video, domain.Subtitle, error) {
	if s != nil && s.refreshSubtitlesHook != nil {
		return s.refreshSubtitlesHook(videoID, targetPath, sourceOverrides)
	}
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}
	if !found {
		return domain.Video{}, domain.Subtitle{}, ErrNotFound
	}

	subs, err := s.scanner.ScanSubtitlesForVideo(video.Path)
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}
	applySubtitleSourceOverrides(subs, sourceOverrides)

	updatedAt := time.Now().UTC()
	err = s.store.UpdateVideoSubtitles(videoID, subs, updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Video{}, domain.Subtitle{}, ErrNotFound
	}
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}

	updatedVideo, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}
	if !found {
		return domain.Video{}, domain.Subtitle{}, ErrNotFound
	}

	if targetPath == "" {
		return updatedVideo, domain.Subtitle{}, nil
	}
	for _, sub := range updatedVideo.Subtitles {
		if strings.EqualFold(sub.Path, targetPath) {
			return updatedVideo, sub, nil
		}
	}
	return domain.Video{}, domain.Subtitle{}, ErrNotFound
}

func applySubtitleSourceOverrides(subtitles []domain.Subtitle, overrides map[string]subtitleSourceOverride) {
	if len(overrides) == 0 {
		return
	}
	for i := range subtitles {
		override, ok := overrides[subtitleSourceOverrideKey(subtitles[i].Path)]
		if !ok {
			continue
		}
		subtitles[i].Source = override.Source
		subtitles[i].SourceDetail = strings.TrimSpace(override.SourceDetail)
	}
}

func subtitleSourceOverrideKey(pathValue string) string {
	normalized := filepath.Clean(strings.TrimSpace(pathValue))
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	return strings.ToLower(normalized)
}

func subtitleSourceDetailFromUpload(uploadName string, targetPath string) string {
	cleanUploadName := strings.ReplaceAll(strings.TrimSpace(uploadName), "\\", "/")
	detail := strings.TrimSpace(filepath.Base(cleanUploadName))
	if detail != "" && detail != "." {
		return detail
	}
	return filepath.Base(targetPath)
}

func findSubtitle(subtitles []domain.Subtitle, subtitleID string) (domain.Subtitle, bool) {
	for _, sub := range subtitles {
		if sub.ID == subtitleID {
			return sub, true
		}
	}
	return domain.Subtitle{}, false
}

func makeID(s string) string {
	return idhash.FromString(s)
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (s *Service) isWithinMediaRoots(targetPath string) bool {
	if subtitle.EnsureWithinRoot(s.cfg.MovieMediaRoot, targetPath) {
		return true
	}
	return subtitle.EnsureWithinRoot(s.cfg.TVMediaRoot, targetPath)
}
