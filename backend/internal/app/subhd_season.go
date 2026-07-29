package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/archive"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
	"subtitle-ui/backend/internal/subtitle"
)

// SubHDSeasonPrepareOptions downloads a SubHD pack and proposes episode mappings.
type SubHDSeasonPrepareOptions struct {
	SID      string
	VideoIDs []string
	// Season scopes matching to one season and fills episode-only names (01.srt → S{season}E01).
	// Zero or negative means no default season (strict SxxExx only for episode-only fallbacks).
	Season             int
	LanguagePreference string
	FormatPreference   string
	SkipExisting       bool
	Label              string
}

// SubHDSeasonSuggestedMapping is one auto-mapped pack entry → episode.
type SubHDSeasonSuggestedMapping struct {
	VideoID      string `json:"videoId"`
	ArchiveEntry string `json:"archiveEntry"`
	Label        string `json:"label,omitempty"`
	Skipped      bool   `json:"skipped,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

// SubHDSeasonPrepareResult is returned after downloading a season pack once.
type SubHDSeasonPrepareResult struct {
	CacheToken        string                        `json:"cacheToken"`
	SID               string                        `json:"sid"`
	FileName          string                        `json:"fileName"`
	Entries           []archive.Entry               `json:"entries"`
	SuggestedMappings []SubHDSeasonSuggestedMapping `json:"suggestedMappings"`
	Notices           []string                      `json:"notices,omitempty"`
}

// SubHDSeasonInstallOptions installs pack entries from a prepare cache token.
type SubHDSeasonInstallOptions struct {
	CacheToken string
	Mappings   []ArchiveBatchMapping
}

// SubHDSeasonInstallResult is per-item install outcome.
type SubHDSeasonInstallResult struct {
	Results []ArchiveBatchItemResult `json:"results"`
}

// BuildSubHDSeasonQuery builds a season-level SubHD search query (no episode).
func BuildSubHDSeasonQuery(video domain.Video, season int) string {
	title := seriesTitleForSubHD(video)
	if title == "" {
		return ""
	}
	if season < 0 {
		if se := parseSeasonEpisodeNumbers(video.FileName); se != nil {
			season = se.Season
		}
	}
	if season < 0 {
		return title
	}
	return fmt.Sprintf("%s S%02d", title, season)
}

func seriesTitleForSubHD(video domain.Video) string {
	if video.MediaType == domain.MediaTypeTV {
		if t := strings.TrimSpace(video.SeriesOriginalTitle); t != "" {
			return t
		}
		if t := strings.TrimSpace(video.SeriesTitle); t != "" {
			return t
		}
	}
	if t := strings.TrimSpace(video.OriginalTitle); t != "" {
		return t
	}
	if t := strings.TrimSpace(video.Title); t != "" {
		return t
	}
	return strings.TrimSpace(strings.TrimSuffix(video.FileName, filepath.Ext(video.FileName)))
}

// PrepareSubHDSeasonPack downloads sid once, caches payload, lists subtitle entries, suggests mappings.
func (s *Service) PrepareSubHDSeasonPack(ctx context.Context, opts SubHDSeasonPrepareOptions) (SubHDSeasonPrepareResult, error) {
	client := s.subhdClient()
	if client == nil || !client.Enabled() {
		return SubHDSeasonPrepareResult{}, ErrProviderDisabled
	}
	sid := strings.TrimSpace(opts.SID)
	if sid == "" {
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: missing sid", ErrBadRequest)
	}
	if len(opts.VideoIDs) == 0 {
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: empty videoIds", ErrBadRequest)
	}

	videos := make([]domain.Video, 0, len(opts.VideoIDs))
	for _, id := range opts.VideoIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		video, ok := s.GetVideo(id)
		if !ok {
			return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: video %s", ErrNotFound, id)
		}
		videos = append(videos, video)
	}
	if len(videos) == 0 {
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: empty videoIds", ErrBadRequest)
	}

	dl, err := client.Download(ctx, sid)
	if err != nil {
		s.recordOp("download", videos[0].ID, "", "", "error", err.Error())
		return SubHDSeasonPrepareResult{}, mapSubHDError(err)
	}

	fileName := dl.FileName
	if fileName == "" {
		fileName = "pack.bin"
	}

	var entries []archive.Entry
	if archive.IsArchive(dl.Data, fileName) {
		entries, err = archive.ListSubtitleEntries(dl.Data, fileName)
		if err != nil {
			log.Printf("subhd season prepare failed sid=%s reason=list_entries fileName=%q bytes=%d err=%v",
				sid, fileName, len(dl.Data), err)
			return SubHDSeasonPrepareResult{}, mapArchiveError(err)
		}
	} else if archive.IsAllowedSubtitleExt(strings.ToLower(path.Ext(fileName))) {
		entries = []archive.Entry{{
			Path:     fileName,
			FileName: path.Base(fileName),
			Size:     int64(len(dl.Data)),
		}}
	} else if archive.IsUnsupportedArchive(dl.Data, fileName) {
		log.Printf("subhd season prepare failed sid=%s reason=unsupported_archive fileName=%q bytes=%d",
			sid, fileName, len(dl.Data))
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: unsupported archive", ErrBadRequest)
	} else {
		log.Printf("subhd season prepare failed sid=%s reason=not_installable fileName=%q bytes=%d",
			sid, fileName, len(dl.Data))
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: not an installable subtitle pack", ErrInvalidFileType)
	}

	token, cacheErr := s.subhdPackCache.put(sid, fileName, strings.TrimSpace(dl.URL), dl.Data)
	if cacheErr != nil {
		log.Printf("subhd season prepare failed sid=%s reason=pack_cache fileName=%q bytes=%d err=%v",
			sid, fileName, len(dl.Data), cacheErr)
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: pack cache: %v", ErrBadRequest, cacheErr)
	}
	langPref := strings.TrimSpace(strings.ToLower(opts.LanguagePreference))
	if langPref == "" {
		// Prefer bilingual packs by default when present.
		langPref = "bilingual"
	}
	formatPref := strings.TrimSpace(strings.ToLower(opts.FormatPreference))
	if formatPref == "" {
		formatPref = "any"
	}
	// Empty label means per-entry inference (do not force "zh" over bilingual names).
	label := strings.TrimSpace(opts.Label)

	suggested, notices := suggestSeasonPackMappings(videos, entries, langPref, formatPref, label, opts.SkipExisting, opts.Season)
	return SubHDSeasonPrepareResult{
		CacheToken:        token,
		SID:               sid,
		FileName:          fileName,
		Entries:           entries,
		SuggestedMappings: suggested,
		Notices:           notices,
	}, nil
}

// InstallSubHDSeasonPack installs mappings from a prepare cache token (no re-download).
func (s *Service) InstallSubHDSeasonPack(ctx context.Context, opts SubHDSeasonInstallOptions) (SubHDSeasonInstallResult, error) {
	_ = ctx
	token := strings.TrimSpace(opts.CacheToken)
	if token == "" {
		return SubHDSeasonInstallResult{}, fmt.Errorf("%w: missing cacheToken", ErrBadRequest)
	}
	if len(opts.Mappings) == 0 {
		return SubHDSeasonInstallResult{}, fmt.Errorf("%w: empty mappings", ErrBadRequest)
	}
	cached, ok := s.subhdPackCache.get(token)
	if !ok {
		return SubHDSeasonInstallResult{}, fmt.Errorf("%w: pack cache expired; prepare again", ErrBadRequest)
	}

	payload := cached.Data
	fileName := cached.FileName
	sid := cached.SID
	downloadURL := strings.TrimSpace(cached.URL)

	var extracted map[string][]byte
	var err error
	if archive.IsArchive(payload, fileName) {
		extracted, err = archive.ExtractAllSubtitles(payload, fileName)
		if err != nil {
			return SubHDSeasonInstallResult{}, mapArchiveError(err)
		}
	} else {
		// Single plain subtitle payload.
		extracted = map[string][]byte{fileName: payload}
	}

	results := make([]ArchiveBatchItemResult, 0, len(opts.Mappings))
	for _, m := range opts.Mappings {
		item := ArchiveBatchItemResult{
			VideoID:      strings.TrimSpace(m.VideoID),
			ArchiveEntry: strings.TrimSpace(m.ArchiveEntry),
		}
		if item.VideoID == "" {
			item.Error = "missing videoId"
			results = append(results, item)
			continue
		}
		entryKey := item.ArchiveEntry
		if entryKey == "" {
			// Single-file pack: allow empty entry when only one payload key.
			if len(extracted) == 1 {
				for k := range extracted {
					entryKey = k
				}
			}
		}
		if entryKey == "" {
			item.Error = "missing archiveEntry"
			results = append(results, item)
			continue
		}
		data, found := lookupExtractedEntry(extracted, entryKey)
		if !found {
			item.Error = fmt.Sprintf("archive entry not found: %s", entryKey)
			results = append(results, item)
			continue
		}
		entryBase := path.Base(strings.ReplaceAll(entryKey, "\\", "/"))
		ext := strings.ToLower(filepath.Ext(entryBase))
		if !subtitle.IsValidExtension(ext) {
			item.Error = ErrInvalidFileType.Error()
			results = append(results, item)
			continue
		}

		label := strings.TrimSpace(m.Label)
		if label == "" {
			label = inferLabelFromName(entryBase)
		}
		resolved := &subhd.ResolvedSubtitle{
			SID:      sid,
			FileName: entryBase,
			Ext:      ext,
			Data:     data,
			Source:   fileName,
			URL:      downloadURL,
		}
		sub, installErr := s.installResolvedSubHD(item.VideoID, sid, resolved, SubHDInstallOptions{Label: label})
		if installErr != nil {
			item.Error = installErr.Error()
			results = append(results, item)
			continue
		}
		item.OK = true
		item.Subtitle = &sub
		item.ArchiveEntry = entryKey
		results = append(results, item)
	}
	return SubHDSeasonInstallResult{Results: results}, nil
}

// installResolvedSubHD writes an already-resolved SubHD subtitle (shared by single + season install).
func (s *Service) installResolvedSubHD(videoID string, sid string, resolved *subhd.ResolvedSubtitle, opts SubHDInstallOptions) (domain.Subtitle, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
	}
	if resolved == nil || len(resolved.Data) == 0 {
		return domain.Subtitle{}, fmt.Errorf("%w: empty subtitle payload", ErrBadRequest)
	}
	ext := strings.ToLower(resolved.Ext)
	if !subtitle.IsValidExtension(ext) {
		return domain.Subtitle{}, ErrInvalidFileType
	}

	label := subtitle.DetectSubtitleLanguageLabel(subtitle.DetectLanguageOptions{
		ExplicitLabel: opts.Label,
		NameHints:     []string{resolved.FileName, resolved.Source},
		Content:       resolved.Data,
		Format:        ext,
		DefaultLabel:  "zh",
	})

	var err error
	targetPath := ""
	backupPath := ""
	action := "download"
	replaceSourcePath := ""

	if opts.ReplaceID != "" {
		existing, found := findSubtitle(video.Subtitles, opts.ReplaceID)
		if !found {
			return domain.Subtitle{}, ErrNotFound
		}
		if !s.isWithinMediaRoots(existing.Path) {
			return domain.Subtitle{}, ErrUnsafePath
		}
		replaceSourcePath = existing.Path
		backupPath, err = subtitle.BackupFile(existing.Path)
		if err != nil {
			err = fmt.Errorf("backup before replace failed: %w", err)
			s.recordOp("download_replace", videoID, existing.Path, "", "error", err.Error())
			return domain.Subtitle{}, err
		}
		targetPath = subtitle.BuildReplacementSubtitlePath(existing.Path, ext)
		if !sameFilePath(targetPath, existing.Path) && subtitle.PathExists(targetPath) {
			return domain.Subtitle{}, fmt.Errorf("%w: subtitle path conflict: %s", ErrBadRequest, filepath.Base(targetPath))
		}
		action = "download_replace"
	} else {
		targetPath, err = subtitle.BuildNewSubtitlePath(video.Path, label, ext)
		if err != nil {
			return domain.Subtitle{}, err
		}
	}

	if !s.isWithinMediaRoots(targetPath) {
		return domain.Subtitle{}, ErrUnsafePath
	}
	if err := subtitle.WriteFileBytes(resolved.Data, targetPath); err != nil {
		s.recordOp(action, videoID, targetPath, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}
	if replaceSourcePath != "" && !sameFilePath(targetPath, replaceSourcePath) {
		if err := os.Remove(replaceSourcePath); err != nil {
			err = fmt.Errorf("cleanup replaced subtitle failed: %w", err)
			s.recordOp(action, videoID, targetPath, backupPath, "error", err.Error())
			return domain.Subtitle{}, err
		}
	}

	pageURL := ""
	if client := s.subhdClient(); client != nil {
		pageURL = client.PageURL(sid)
	}
	detail := buildSubHDSourceDetail(sid, resolved, pageURL)

	sourceOverrides := map[string]subtitleSourceOverride{
		subtitleSourceOverrideKey(targetPath): {
			Source:       domain.SubtitleSourceDownload,
			SourceDetail: detail,
		},
	}
	updatedVideo, updatedSub, err := s.refreshVideoSubtitles(videoID, targetPath, sourceOverrides)
	if err != nil {
		s.recordOp(action, videoID, targetPath, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}

	meta := map[string]any{
		"created": opts.ReplaceID == "",
		"toPath":  targetPath,
		"sid":     sid,
	}
	if replaceSourcePath != "" {
		meta["fromPath"] = replaceSourcePath
	}
	s.recordOpEx(OpRecord{
		Action:     action,
		VideoID:    updatedVideo.ID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     "ok",
		Message:    detail,
		Meta:       meta,
	})
	return updatedSub, nil
}

// SubHDSeasonPacksResult is the response for season-pack search (title-page 合集 only).
type SubHDSeasonPacksResult struct {
	Query        string               `json:"query"`
	Season       int                  `json:"season"`
	DoubanID     string               `json:"doubanId,omitempty"`
	TitlePageURL string               `json:"titlePageUrl,omitempty"`
	Title        string               `json:"title,omitempty"`
	Items        []subhd.SearchResult `json:"items"`
	Message      string               `json:"message,omitempty"`
}

// SubHDSeasonPacksOptions controls season-pack listing.
type SubHDSeasonPacksOptions struct {
	Query  string
	Season int
}

// SearchSubHDSeasonPacks resolves the SubHD /d/{douban} title page and returns only 合集 listings.
func (s *Service) SearchSubHDSeasonPacks(ctx context.Context, videoID string, opts SubHDSeasonPacksOptions) (SubHDSeasonPacksResult, error) {
	client := s.subhdClient()
	if client == nil || !client.Enabled() {
		return SubHDSeasonPacksResult{}, ErrProviderDisabled
	}
	video, ok := s.GetVideo(videoID)
	if !ok {
		return SubHDSeasonPacksResult{}, ErrNotFound
	}
	season := opts.Season
	if season < 0 {
		season = -1
	}
	query := strings.TrimSpace(opts.Query)
	if query == "" {
		query = BuildSubHDSeasonQuery(video, season)
	}
	if query == "" {
		return SubHDSeasonPacksResult{}, fmt.Errorf("%w: empty search query", ErrBadRequest)
	}

	page, err := client.Search(ctx, query, 1)
	if err != nil {
		return SubHDSeasonPacksResult{}, mapSubHDError(err)
	}
	doubanID := pickDoubanIDFromSearch(page.Items, query, season)
	if doubanID == "" {
		return SubHDSeasonPacksResult{
			Query:   query,
			Season:  season,
			Items:   []subhd.SearchResult{},
			Message: "cannot resolve SubHD title page (no douban id in search results)",
		}, nil
	}

	titlePage, err := client.ListTitlePacks(ctx, doubanID)
	if err != nil {
		return SubHDSeasonPacksResult{}, mapSubHDError(err)
	}
	items := titlePage.Packs
	if items == nil {
		items = []subhd.SearchResult{}
	}
	// Prefer packs that look like the requested season when multiple exist.
	if season >= 0 {
		items = sortPacksForSeason(items, season)
	}
	// Within season ranking, prefer bilingual listings.
	sortSubHDResultsPreferBilingual(items)
	msg := ""
	if len(items) == 0 {
		msg = "no season packs on SubHD title page"
	}
	return SubHDSeasonPacksResult{
		Query:        query,
		Season:       season,
		DoubanID:     doubanID,
		TitlePageURL: "/d/" + doubanID,
		Title:        titlePage.Title,
		Items:        items,
		Message:      msg,
	}, nil
}
