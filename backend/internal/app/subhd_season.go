package app

import (
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/archive"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
	"subtitle-ui/backend/internal/subtitle"
)

// SubHDSeasonPrepareOptions downloads a SubHD pack and proposes episode mappings.
type SubHDSeasonPrepareOptions struct {
	SID                string
	VideoIDs           []string
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
	CacheToken         string                        `json:"cacheToken"`
	SID                string                        `json:"sid"`
	FileName           string                        `json:"fileName"`
	Entries            []archive.Entry               `json:"entries"`
	SuggestedMappings  []SubHDSeasonSuggestedMapping `json:"suggestedMappings"`
	Notices            []string                      `json:"notices,omitempty"`
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
		_ = s.store.AppendLog(domain.OperationLog{
			ID:        makeID(fmt.Sprintf("season-download-error-%s-%d", sid, time.Now().UnixNano())),
			Timestamp: time.Now().UTC(),
			Action:    "download",
			VideoID:   videos[0].ID,
			Status:    "error",
			Message:   err.Error(),
		})
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
			return SubHDSeasonPrepareResult{}, mapArchiveError(err)
		}
	} else if archive.IsAllowedSubtitleExt(strings.ToLower(path.Ext(fileName))) {
		entries = []archive.Entry{{
			Path:     fileName,
			FileName: path.Base(fileName),
			Size:     int64(len(dl.Data)),
		}}
	} else if archive.IsUnsupportedArchive(dl.Data, fileName) {
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: unsupported archive", ErrBadRequest)
	} else {
		return SubHDSeasonPrepareResult{}, fmt.Errorf("%w: not an installable subtitle pack", ErrInvalidFileType)
	}

	token := s.subhdPackCache.put(sid, fileName, dl.Data)
	langPref := strings.TrimSpace(strings.ToLower(opts.LanguagePreference))
	if langPref == "" {
		langPref = "any"
	}
	formatPref := strings.TrimSpace(strings.ToLower(opts.FormatPreference))
	if formatPref == "" {
		formatPref = "any"
	}
	label := strings.TrimSpace(opts.Label)
	if label == "" {
		label = "zh"
	}

	suggested, notices := suggestSeasonPackMappings(videos, entries, langPref, formatPref, label, opts.SkipExisting)
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

	label := strings.TrimSpace(opts.Label)
	if label == "" {
		label = inferLabelFromSubHD(resolved)
	}

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
			return domain.Subtitle{}, fmt.Errorf("backup before replace failed: %w", err)
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
		return domain.Subtitle{}, err
	}
	if replaceSourcePath != "" && !sameFilePath(targetPath, replaceSourcePath) {
		if err := os.Remove(replaceSourcePath); err != nil {
			return domain.Subtitle{}, fmt.Errorf("cleanup replaced subtitle failed: %w", err)
		}
	}

	detail := fmt.Sprintf("subhd:%s", sid)
	if base := filepath.Base(resolved.FileName); base != "" && base != "." {
		detail = detail + ":" + base
	}

	sourceOverrides := map[string]subtitleSourceOverride{
		subtitleSourceOverrideKey(targetPath): {
			Source:       domain.SubtitleSourceDownload,
			SourceDetail: detail,
		},
	}
	updatedVideo, updatedSub, err := s.refreshVideoSubtitles(videoID, targetPath, sourceOverrides)
	if err != nil {
		return domain.Subtitle{}, err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("%s-%s-%d", action, targetPath, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     action,
		VideoID:    updatedVideo.ID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     "ok",
		Message:    detail,
	})
	return updatedSub, nil
}

type seasonEpisode struct {
	Season  int
	Episode int
}

var (
	reSE       = regexp.MustCompile(`(?i)\bS(\d{1,2})E(\d{1,3})\b`)
	reNxNN     = regexp.MustCompile(`(?i)\b(\d{1,2})x(\d{1,3})\b`)
	reSeasonEp = regexp.MustCompile(`(?i)\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b`)
)

func parseSeasonEpisodeNumbers(text string) *seasonEpisode {
	for _, re := range []*regexp.Regexp{reSE, reNxNN, reSeasonEp} {
		m := re.FindStringSubmatch(text)
		if len(m) < 3 {
			continue
		}
		s, err1 := strconv.Atoi(m[1])
		e, err2 := strconv.Atoi(m[2])
		if err1 != nil || err2 != nil {
			continue
		}
		return &seasonEpisode{Season: s, Episode: e}
	}
	return nil
}

func seKey(s, e int) string {
	return fmt.Sprintf("S%02dE%02d", s, e)
}

func detectLanguageType(name string) string {
	text := strings.ToLower(name)
	if regexp.MustCompile(`双语|bilingual|中英|简英|繁英|(?:chs|cht|zh)[._\-\s&+]*(?:en|eng)|(?:en|eng)[._\-\s&+]*(?:chs|cht|zh)`).MatchString(text) ||
		strings.Contains(name, "双语") || strings.Contains(name, "中英") {
		return "bilingual"
	}
	if regexp.MustCompile(`简体|简中|chs|gb|zh[-_.\s]?hans|\bsc\b`).MatchString(text) ||
		strings.Contains(name, "简体") || strings.Contains(name, "简中") {
		return "simplified"
	}
	if regexp.MustCompile(`繁体|繁中|cht|big5|zh[-_.\s]?hant|\btc\b`).MatchString(text) ||
		strings.Contains(name, "繁体") || strings.Contains(name, "繁中") {
		return "traditional"
	}
	if regexp.MustCompile(`\b(eng|english|en)\b|英语`).MatchString(text) || strings.Contains(name, "英语") {
		return "english"
	}
	if regexp.MustCompile(`\b(jpn|japanese|jp)\b|日语`).MatchString(text) {
		return "japanese"
	}
	if regexp.MustCompile(`\b(kor|korean|kr)\b|韩语`).MatchString(text) {
		return "korean"
	}
	return "unknown"
}

func entryFormat(name string) string {
	return strings.ToLower(path.Ext(name))
}

func choosePreferredArchiveEntry(entries []archive.Entry, langPref, formatPref string) archive.Entry {
	pool := append([]archive.Entry(nil), entries...)
	if formatPref != "" && formatPref != "any" {
		var byFormat []archive.Entry
		for _, e := range pool {
			if entryFormat(e.FileName) == formatPref {
				byFormat = append(byFormat, e)
			}
		}
		if len(byFormat) > 0 {
			pool = byFormat
		}
	}
	if langPref != "" && langPref != "any" {
		var byLang []archive.Entry
		for _, e := range pool {
			if detectLanguageType(e.Path+" "+e.FileName) == langPref {
				byLang = append(byLang, e)
			}
		}
		if len(byLang) > 0 {
			pool = byLang
		}
	}
	if len(pool) == 0 {
		return archive.Entry{}
	}
	best := pool[0]
	for _, e := range pool[1:] {
		if e.Path < best.Path {
			best = e
		}
	}
	return best
}

func suggestSeasonPackMappings(
	videos []domain.Video,
	entries []archive.Entry,
	langPref, formatPref, label string,
	skipExisting bool,
) ([]SubHDSeasonSuggestedMapping, []string) {
	notices := make([]string, 0)
	// Group entries by SxxExx
	bySE := map[string][]archive.Entry{}
	unparsed := 0
	for _, e := range entries {
		se := parseSeasonEpisodeNumbers(e.Path + " " + e.FileName)
		if se == nil {
			unparsed++
			continue
		}
		key := seKey(se.Season, se.Episode)
		bySE[key] = append(bySE[key], e)
	}
	if unparsed > 0 {
		notices = append(notices, fmt.Sprintf("%d archive entries have no detectable SxxExx", unparsed))
	}

	// Index videos by SxxExx
	videosBySE := map[string][]domain.Video{}
	for _, v := range videos {
		se := parseSeasonEpisodeNumbers(v.FileName + " " + v.Title)
		if se == nil {
			continue
		}
		key := seKey(se.Season, se.Episode)
		videosBySE[key] = append(videosBySE[key], v)
	}

	suggested := make([]SubHDSeasonSuggestedMapping, 0)
	for key, vids := range videosBySE {
		entryList := bySE[key]
		if len(entryList) == 0 {
			continue
		}
		chosen := choosePreferredArchiveEntry(entryList, langPref, formatPref)
		if chosen.Path == "" {
			continue
		}
		// Prefer first video for that episode (stable by path)
		video := vids[0]
		for _, v := range vids[1:] {
			if v.Path < video.Path {
				video = v
			}
		}
		if skipExisting && len(video.Subtitles) > 0 {
			suggested = append(suggested, SubHDSeasonSuggestedMapping{
				VideoID:      video.ID,
				ArchiveEntry: chosen.Path,
				Label:        label,
				Skipped:      true,
				Reason:       "already has subtitles",
			})
			continue
		}
		suggested = append(suggested, SubHDSeasonSuggestedMapping{
			VideoID:      video.ID,
			ArchiveEntry: chosen.Path,
			Label:        label,
		})
	}

	if len(suggested) == 0 {
		notices = append(notices, "no episode mappings could be auto-suggested")
	}
	return suggested, notices
}

func inferLabelFromName(name string) string {
	lang := detectLanguageType(name)
	switch lang {
	case "bilingual":
		return "zh-en"
	case "simplified", "traditional":
		return "zh"
	case "english":
		return "en"
	default:
		return "zh"
	}
}

// SubHDSeasonPacksResult is the response for season-pack search (title-page 合集 only).
type SubHDSeasonPacksResult struct {
	Query        string              `json:"query"`
	Season       int                 `json:"season"`
	DoubanID     string              `json:"doubanId,omitempty"`
	TitlePageURL string              `json:"titlePageUrl,omitempty"`
	Title        string              `json:"title,omitempty"`
	Items        []subhd.SearchResult `json:"items"`
	Message      string              `json:"message,omitempty"`
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

func pickDoubanIDFromSearch(items []subhd.SearchResult, query string, season int) string {
	type scored struct {
		id    string
		score int
	}
	counts := map[string]int{}
	best := scored{}
	qLower := strings.ToLower(query)
	for _, item := range items {
		id := strings.TrimSpace(item.DoubanID)
		if id == "" {
			continue
		}
		counts[id]++
		score := counts[id] * 2
		text := strings.ToLower(item.Title + " " + item.Version)
		if season >= 0 {
			token := fmt.Sprintf("s%02d", season)
			tokenAlt := fmt.Sprintf("s%d", season)
			if strings.Contains(text, token) || strings.Contains(text, tokenAlt) {
				score += 5
			}
			// Chinese season markers
			if strings.Contains(item.Title, fmt.Sprintf("第%d季", season)) ||
				strings.Contains(item.Title, fmt.Sprintf("第%02d季", season)) ||
				strings.Contains(item.Title, "第一季") && season == 1 {
				score += 4
			}
		}
		// Prefer titles overlapping query tokens
		for _, part := range strings.Fields(qLower) {
			if len(part) >= 3 && strings.Contains(text, part) {
				score++
			}
		}
		if score > best.score || (score == best.score && (best.id == "" || id < best.id)) {
			best = scored{id: id, score: score}
		}
	}
	if best.id != "" {
		return best.id
	}
	// majority vote fallback
	var majID string
	majN := 0
	for id, n := range counts {
		if n > majN || (n == majN && (majID == "" || id < majID)) {
			majID = id
			majN = n
		}
	}
	return majID
}

func sortPacksForSeason(items []subhd.SearchResult, season int) []subhd.SearchResult {
	if len(items) <= 1 {
		return items
	}
	type ranked struct {
		item  subhd.SearchResult
		score int
	}
	rankedItems := make([]ranked, 0, len(items))
	for _, item := range items {
		rankedItems = append(rankedItems, ranked{item: item, score: ScoreSubHDSeasonPack(item, season)})
	}
	// simple insertion sort by score desc
	for i := 1; i < len(rankedItems); i++ {
		j := i
		for j > 0 && rankedItems[j].score > rankedItems[j-1].score {
			rankedItems[j], rankedItems[j-1] = rankedItems[j-1], rankedItems[j]
			j--
		}
	}
	out := make([]subhd.SearchResult, len(rankedItems))
	for i, r := range rankedItems {
		out[i] = r.item
	}
	return out
}

// ScoreSubHDSeasonPack ranks a search result as a likely season pack (higher is better).
func ScoreSubHDSeasonPack(item subhd.SearchResult, season int) int {
	if !item.Installable {
		return -1000
	}
	text := strings.ToLower(item.Title + " " + item.Version + " " + item.Format)
	score := 0
	for _, lang := range item.Langs {
		l := strings.ToLower(lang)
		if strings.Contains(l, "简") || strings.Contains(l, "双") || strings.Contains(l, "中") {
			score += 3
		}
		if strings.Contains(l, "英") {
			score += 1
		}
	}
	packHints := []string{"合集", "整季", "pack", "complete", "season", "全集"}
	for _, h := range packHints {
		if strings.Contains(text, h) || strings.Contains(item.Title, h) || strings.Contains(item.Version, h) {
			score += 4
		}
	}
	if season >= 0 {
		token := fmt.Sprintf("s%02d", season)
		tokenAlt := fmt.Sprintf("s%d", season)
		if strings.Contains(text, token) || strings.Contains(text, tokenAlt) {
			score += 5
		}
		// Penalize clear single-episode markers for other episodes.
		if reSE.MatchString(text) && !strings.Contains(text, "合集") && !strings.Contains(text, "pack") {
			score -= 2
		}
	}
	format := strings.ToLower(strings.TrimSpace(item.Format))
	switch format {
	case "", "zip", "rar", "7z":
		score += 2
	case "ass", "ssa", "srt":
		score += 1
	case "sup":
		score -= 5
	}
	return score
}
