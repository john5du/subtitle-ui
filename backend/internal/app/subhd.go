package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
)

// SubHDSearchOptions controls search query overrides.
type SubHDSearchOptions struct {
	Query string
	Page  int
}

// SubHDInstallOptions controls install path labeling / replace / zip entry.
type SubHDInstallOptions struct {
	Label        string
	ReplaceID    string
	ArchiveEntry string
}

// SearchSubHD searches SubHD for subtitles matching the video.
func (s *Service) SearchSubHD(ctx context.Context, videoID string, opts SubHDSearchOptions) (*subhd.SearchPage, error) {
	client := s.subhdClient()
	if client == nil || !client.Enabled() {
		return nil, ErrProviderDisabled
	}
	video, ok := s.GetVideo(videoID)
	if !ok {
		return nil, ErrNotFound
	}
	query := strings.TrimSpace(opts.Query)
	if query == "" {
		query = buildSubHDQuery(video)
	}
	if query == "" {
		return nil, fmt.Errorf("%w: empty search query", ErrBadRequest)
	}
	page := opts.Page
	if page < 1 {
		page = 1
	}
	maxPages := s.cfg.SubHDSearchMaxPages
	if maxPages < 1 {
		maxPages = 1
	}
	if page > maxPages {
		return nil, fmt.Errorf("%w: page exceeds SUBHD_SEARCH_MAX_PAGES (%d)", ErrBadRequest, maxPages)
	}
	result, err := client.Search(ctx, query, page)
	if err != nil {
		return nil, mapSubHDError(err)
	}
	return result, nil
}

// InstallFromSubHD downloads a SubHD subtitle and installs it next to the video.
func (s *Service) InstallFromSubHD(ctx context.Context, videoID string, sid string, opts SubHDInstallOptions) (domain.Subtitle, error) {
	client := s.subhdClient()
	if client == nil || !client.Enabled() {
		return domain.Subtitle{}, ErrProviderDisabled
	}
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return domain.Subtitle{}, fmt.Errorf("%w: missing sid", ErrBadRequest)
	}
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
	}

	dl, err := client.Download(ctx, sid)
	if err != nil {
		_ = s.store.AppendLog(domain.OperationLog{
			ID:        makeID(fmt.Sprintf("download-error-%s-%d", sid, time.Now().UnixNano())),
			Timestamp: time.Now().UTC(),
			Action:    "download",
			VideoID:   videoID,
			Status:    "error",
			Message:   err.Error(),
		})
		return domain.Subtitle{}, mapSubHDError(err)
	}

	resolved, err := subhd.ResolveInstallable(dl, opts.ArchiveEntry)
	if err != nil {
		_ = s.store.AppendLog(domain.OperationLog{
			ID:        makeID(fmt.Sprintf("download-resolve-error-%s-%d", sid, time.Now().UnixNano())),
			Timestamp: time.Now().UTC(),
			Action:    "download",
			VideoID:   videoID,
			Status:    "error",
			Message:   err.Error(),
		})
		return domain.Subtitle{}, mapSubHDError(err)
	}

	_ = video
	return s.installResolvedSubHD(videoID, sid, resolved, opts)
}

func buildSubHDQuery(video domain.Video) string {
	var title string
	if video.MediaType == domain.MediaTypeTV {
		title = strings.TrimSpace(video.SeriesOriginalTitle)
		if title == "" {
			title = strings.TrimSpace(video.SeriesTitle)
		}
	}
	if title == "" {
		title = strings.TrimSpace(video.OriginalTitle)
	}
	if title == "" {
		title = strings.TrimSpace(video.Title)
	}
	if title == "" {
		title = strings.TrimSpace(strings.TrimSuffix(video.FileName, filepath.Ext(video.FileName)))
	}

	parts := make([]string, 0, 3)
	if title != "" {
		parts = append(parts, title)
	}
	if video.MediaType != domain.MediaTypeTV {
		if y := strings.TrimSpace(video.Year); y != "" {
			parts = append(parts, y)
		}
	}
	if se := extractSeasonEpisode(video.FileName); se != "" {
		parts = append(parts, se)
	}
	if len(parts) == 0 {
		if id := strings.TrimSpace(video.ImdbID); id != "" {
			return id
		}
		if id := strings.TrimSpace(video.SeriesImdbID); id != "" {
			return id
		}
	}
	return strings.Join(parts, " ")
}

var reSeasonEpisode = regexp.MustCompile(`(?i)\bS(\d{1,2})E(\d{1,3})\b`)

func extractSeasonEpisode(fileName string) string {
	m := reSeasonEpisode.FindStringSubmatch(fileName)
	if len(m) < 3 {
		return ""
	}
	return "S" + pad2(m[1]) + "E" + pad2(m[2])
}

func pad2(s string) string {
	s = strings.TrimLeft(s, "0")
	if s == "" {
		s = "0"
	}
	if len(s) == 1 {
		return "0" + s
	}
	return s
}

func inferLabelFromSubHD(resolved *subhd.ResolvedSubtitle) string {
	if resolved == nil {
		return "subhd"
	}
	name := strings.ToLower(resolved.FileName + " " + resolved.Source)
	hasZh := strings.Contains(name, "chs") || strings.Contains(name, "zh") ||
		strings.Contains(resolved.FileName, "简") || strings.Contains(resolved.Source, "简")
	hasEn := strings.Contains(name, "eng") || strings.Contains(name, "en") ||
		strings.Contains(resolved.FileName, "英") || strings.Contains(resolved.Source, "英")
	switch {
	case hasZh && hasEn:
		return "zh-en"
	case hasZh:
		return "zh"
	case hasEn:
		return "en"
	default:
		return "subhd"
	}
}

func mapSubHDError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, subhd.ErrDisabled):
		return ErrProviderDisabled
	case errors.Is(err, subhd.ErrRateLimited):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, subhd.ErrCaptchaFailed):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, subhd.ErrUnsupportedArchive):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, subhd.ErrMultipleEntries):
		var multi *subhd.MultipleEntriesError
		if errors.As(err, &multi) {
			return &ArchiveMultipleEntriesError{Entries: multi.Entries}
		}
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, subhd.ErrNoSubtitleInArchive):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, subhd.ErrNotInstallable):
		return fmt.Errorf("%w: %v", ErrInvalidFileType, err)
	case errors.Is(err, subhd.ErrEmptySID), errors.Is(err, subhd.ErrEmptyQuery):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, subhd.ErrTokenExpired):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	default:
		return err
	}
}
