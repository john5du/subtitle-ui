package app

import (
	"database/sql"
	"errors"
	"hash/fnv"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

func (s *Service) refreshVideoSubtitles(videoID string, targetPath string, sourceOverrides map[string]subtitleSourceOverride) (domain.Video, domain.Subtitle, error) {
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
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToLower(s)))
	return strings.ToUpper(formatUintHex(h.Sum64()))
}

func formatUintHex(v uint64) string {
	const alphabet = "0123456789ABCDEF"
	if v == 0 {
		return "0"
	}
	var out [16]byte
	pos := len(out)
	for v > 0 {
		pos--
		out[pos] = alphabet[v&0x0F]
		v >>= 4
	}
	return string(out[pos:])
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
