package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
	"subtitle-ui/backend/internal/subtitle"
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
	if result != nil {
		sortSubHDResultsPreferBilingual(result.Items)
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
		s.recordOpCtx(ctx, "download", videoID, "", "", "error", err.Error())
		return domain.Subtitle{}, mapSubHDError(err)
	}

	resolved, err := subhd.ResolveInstallable(dl, opts.ArchiveEntry)
	if err != nil {
		s.recordOpCtx(ctx, "download", videoID, "", "", "error", err.Error())
		return domain.Subtitle{}, mapSubHDError(err)
	}

	_ = video
	return s.installResolvedSubHD(ctx, videoID, sid, resolved, opts)
}

// buildSubHDSourceDetail records SubHD provenance including the detail page URL.
func buildSubHDSourceDetail(sid string, resolved *subhd.ResolvedSubtitle, pageURL string) string {
	detail := fmt.Sprintf("subhd:%s", strings.TrimSpace(sid))
	if resolved != nil {
		if base := filepath.Base(resolved.FileName); base != "" && base != "." {
			detail = detail + ":" + base
		}
	}
	if u := strings.TrimSpace(pageURL); u != "" {
		detail = detail + "\n" + u
	}
	return detail
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
		return "zh"
	}
	return subtitle.DetectSubtitleLanguageLabel(subtitle.DetectLanguageOptions{
		NameHints:    []string{resolved.FileName, resolved.Source},
		Content:      resolved.Data,
		Format:       resolved.Ext,
		DefaultLabel: "zh",
	})
}

// inferSubtitleLanguageLabel maps free-text names into filename language labels.
func inferSubtitleLanguageLabel(parts ...string) string {
	return subtitle.DetectSubtitleLanguageLabel(subtitle.DetectLanguageOptions{
		NameHints:    parts,
		DefaultLabel: "zh",
	})
}

// sortSubHDResultsPreferBilingual stable-sorts search hits: bilingual first, then simplified, then rest.
func sortSubHDResultsPreferBilingual(items []subhd.SearchResult) {
	if len(items) < 2 {
		return
	}
	type ranked struct {
		item  subhd.SearchResult
		score int
		idx   int
	}
	rankedItems := make([]ranked, len(items))
	for i, item := range items {
		rankedItems[i] = ranked{item: item, score: subHDResultLanguageScore(item), idx: i}
	}
	sort.SliceStable(rankedItems, func(i, j int) bool {
		if rankedItems[i].score != rankedItems[j].score {
			return rankedItems[i].score > rankedItems[j].score
		}
		return rankedItems[i].idx < rankedItems[j].idx
	})
	for i := range rankedItems {
		items[i] = rankedItems[i].item
	}
}

func subHDResultLanguageScore(item subhd.SearchResult) int {
	blob := strings.Join(item.Langs, " ") + " " + item.Title + " " + item.Version
	switch subtitle.DetectLanguageType(blob) {
	case "bilingual":
		return 100
	case "simplified":
		return 60
	case "traditional":
		return 50
	case "english":
		return 20
	default:
		// Still boost explicit 双语 tags in langs.
		for _, lang := range item.Langs {
			if strings.Contains(lang, "双语") {
				return 100
			}
			if strings.Contains(lang, "简体") {
				return 60
			}
		}
		return 0
	}
}

// videoHasBilingualSubtitle reports whether any track is already bilingual.
func videoHasBilingualSubtitle(video domain.Video) bool {
	for _, sub := range video.Subtitles {
		if subtitle.IsBilingualLanguage(sub.Language) {
			return true
		}
	}
	return false
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
