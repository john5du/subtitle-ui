package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"mime/multipart"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/scanner"
	"subtitle-ui/backend/internal/store"
	"subtitle-ui/backend/internal/subtitle"
	"subtitle-ui/backend/internal/version"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrBadRequest      = errors.New("bad request")
	ErrUnsafePath      = errors.New("unsafe path")
	ErrInvalidFileType = errors.New("invalid subtitle file extension")
)

const (
	systemOperationVideoID = "SYSTEM"
	defaultLogPageSize     = 8
)

type Service struct {
	cfg     config.Config
	scanner *scanner.Scanner
	store   *store.Store

	scanRunMu sync.Mutex

	statusMu      sync.RWMutex
	scanRunning   bool
	scanStartedAt *time.Time

	dirScanMu   sync.RWMutex
	lastDirScan domain.DirectoryScanResult
}

func NewService(cfg config.Config) (*Service, error) {
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	return &Service{
		cfg:     cfg,
		scanner: scanner.New(),
		store:   st,
	}, nil
}

func (s *Service) Close() error {
	return s.store.Close()
}

func (s *Service) CheckMediaRootWritePermissions() []string {
	roots := uniqueCleanPaths(s.cfg.MovieMediaRoot, s.cfg.TVMediaRoot)
	issues := make([]string, 0, len(roots))
	for _, root := range roots {
		if err := ensureDirectoryWritable(root); err != nil {
			msg := fmt.Sprintf("media root %s is not writable: %v", root, err)
			issues = append(issues, msg)
			_ = s.store.AppendLog(domain.OperationLog{
				ID:         makeID(fmt.Sprintf("permission-check-%s-%d", root, time.Now().UnixNano())),
				Timestamp:  time.Now().UTC(),
				Action:     "permission_check",
				VideoID:    systemOperationVideoID,
				TargetPath: root,
				Status:     "error",
				Message:    msg,
			})
		}
	}
	return issues
}

func (s *Service) RunScan(ctx context.Context) domain.ScanStatus {
	return s.RunFileScan(ctx, nil, nil)
}

func (s *Service) RunFileScan(ctx context.Context, movieDirs []string, tvDirs []string) domain.ScanStatus {
	if !s.scanRunMu.TryLock() {
		status := s.ScanStatus()
		if strings.TrimSpace(status.Error) == "" {
			status.Error = "scan already running"
		}
		return status
	}
	defer s.scanRunMu.Unlock()

	beforeVideos, beforeErr := s.listAllVideos()
	if beforeErr != nil {
		beforeVideos = []domain.Video{}
	}

	started := time.Now().UTC()
	s.statusMu.Lock()
	s.scanRunning = true
	s.scanStartedAt = &started
	s.statusMu.Unlock()

	type scanResult struct {
		videos []domain.Video
		err    error
	}
	done := make(chan scanResult, 1)
	go func() {
		movieTargets, movieResolveErr := s.resolveDirectoriesForType(domain.MediaTypeMovie, movieDirs)
		tvTargets, tvResolveErr := s.resolveDirectoriesForType(domain.MediaTypeTV, tvDirs)

		result := make([]domain.Video, 0, 256)
		var movieScanErr error
		if len(movieTargets) > 0 {
			movieVideos, err := s.scanner.ScanDirectoriesWithTypeCtx(ctx, movieTargets, domain.MediaTypeMovie)
			movieScanErr = err
			result = append(result, movieVideos...)
		}

		var tvScanErr error
		if len(tvTargets) > 0 {
			tvVideos, err := s.scanner.ScanDirectoriesWithTypeCtx(ctx, tvTargets, domain.MediaTypeTV)
			tvScanErr = err
			result = append(result, tvVideos...)
		}

		result = s.assignPosterPaths(result)

		done <- scanResult{
			videos: result,
			err: combineErrors(
				prefixedError("movie directory resolve", movieResolveErr),
				prefixedError("tv directory resolve", tvResolveErr),
				prefixedError("movie scan", movieScanErr),
				prefixedError("tv scan", tvScanErr),
			),
		}
	}()

	result := <-done

	finished := time.Now().UTC()

	canceled := errors.Is(result.err, context.Canceled) || errors.Is(result.err, context.DeadlineExceeded)
	wipeGuardTripped := false
	if !canceled && result.err == nil && len(result.videos) == 0 && len(beforeVideos) > 0 {
		wipeGuardTripped = true
		result.err = fmt.Errorf(
			"scan returned no videos but previous scan had %d; refusing to overwrite database (check media root access)",
			len(beforeVideos),
		)
	}

	var saveErr error
	if !canceled {
		saveErr = s.store.SaveScanResult(result.videos, started, finished, errorString(result.err))
		if saveErr != nil {
			result.err = combineErrors(result.err, prefixedError("persist scan result", saveErr))
		}
	}

	currentVideos, currentErr := s.listAllVideos()
	if currentErr != nil {
		result.err = combineErrors(result.err, prefixedError("load current videos", currentErr))
		currentVideos = result.videos
	}

	changes := calculateVideoChanges(beforeVideos, currentVideos)
	scanMessage := fmt.Sprintf(
		"videos=%d added=%d removed=%d updated=%d",
		len(currentVideos),
		changes.Added,
		changes.Removed,
		changes.Updated,
	)
	if beforeErr != nil {
		scanMessage += fmt.Sprintf("; baseline unavailable: %v", beforeErr)
	}
	if canceled {
		scanMessage += "; scan canceled"
	}
	if wipeGuardTripped {
		scanMessage += "; wipe guard tripped"
	}
	if result.err != nil {
		scanMessage += fmt.Sprintf("; error=%s", result.err.Error())
	}
	scanStatus := "ok"
	if result.err != nil {
		scanStatus = "error"
	}
	_ = s.store.AppendLog(domain.OperationLog{
		ID:        makeID(fmt.Sprintf("scan-%d", time.Now().UnixNano())),
		Timestamp: time.Now().UTC(),
		Action:    "scan",
		VideoID:   systemOperationVideoID,
		Status:    scanStatus,
		Message:   scanMessage,
	})

	s.statusMu.Lock()
	s.scanRunning = false
	s.statusMu.Unlock()

	status := s.ScanStatus()
	if result.err != nil {
		status.Error = result.err.Error()
	}
	return status
}

func (s *Service) DiscoverDirectories(ctx context.Context) domain.DirectoryScanResult {
	movieRoot := filepath.Clean(s.cfg.MovieMediaRoot)
	tvRoot := filepath.Clean(s.cfg.TVMediaRoot)
	result := domain.DirectoryScanResult{
		GeneratedAt:   time.Now().UTC(),
		MovieRoot:     movieRoot,
		TVRoot:        tvRoot,
		MovieCount:    0,
		TVSeriesCount: 0,
		Movie:         []domain.ScanDirectory{},
		TV:            []domain.ScanDirectory{},
	}

	type discoverResult struct {
		dirs []domain.ScanDirectory
		err  error
	}

	movieCh := make(chan discoverResult, 1)
	tvCh := make(chan discoverResult, 1)

	go func() {
		dirs, err := s.scanner.DiscoverDirectoriesCtx(ctx, movieRoot, domain.MediaTypeMovie)
		movieCh <- discoverResult{dirs: dirs, err: err}
	}()
	go func() {
		if strings.EqualFold(movieRoot, tvRoot) {
			tvCh <- discoverResult{dirs: []domain.ScanDirectory{}, err: nil}
			return
		}
		dirs, err := s.scanner.DiscoverDirectoriesCtx(ctx, tvRoot, domain.MediaTypeTV)
		tvCh <- discoverResult{dirs: dirs, err: err}
	}()

	var movieRes discoverResult
	var tvRes discoverResult
	select {
	case <-ctx.Done():
		result.Errors = []string{ctx.Err().Error()}
		s.setLastDirectoryScan(result)
		return result
	case movieRes = <-movieCh:
	}
	select {
	case <-ctx.Done():
		result.Errors = append(result.Errors, ctx.Err().Error())
		s.setLastDirectoryScan(result)
		return result
	case tvRes = <-tvCh:
	}

	result.Movie = movieRes.dirs
	result.TV = tvRes.dirs
	if movieRes.err != nil {
		result.Errors = append(result.Errors, "movie: "+movieRes.err.Error())
	}
	if tvRes.err != nil {
		result.Errors = append(result.Errors, "tv: "+tvRes.err.Error())
	}

	s.populateDirectoryScanCounts(&result)
	s.setLastDirectoryScan(result)
	return result
}

func (s *Service) LastDirectoryScan() domain.DirectoryScanResult {
	s.dirScanMu.RLock()
	result := cloneDirectoryScanResult(s.lastDirScan)
	s.dirScanMu.RUnlock()
	s.populateDirectoryScanCounts(&result)
	return result
}

func (s *Service) ScanStatus() domain.ScanStatus {
	status, err := s.store.GetLatestScanStatus()
	if err != nil {
		status.Error = err.Error()
	}

	s.statusMu.RLock()
	defer s.statusMu.RUnlock()
	status.Running = s.scanRunning
	if s.scanRunning && s.scanStartedAt != nil {
		started := *s.scanStartedAt
		status.LastStartedAt = &started
	}
	return status
}

func (s *Service) ListVideosPage(query string, mediaType string, directory string, page int, pageSize int, sortBy string, sortOrder string) domain.VideoPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	videos, total, err := s.store.ListVideos(query, mediaType, directory, page, pageSize, sortBy, sortOrder)
	if err != nil {
		return domain.VideoPage{
			Items:      []domain.Video{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return domain.VideoPage{
		Items:      videos,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

func (s *Service) ListTVSeriesPage(query string, page int, pageSize int, sortYear string, sortOrder string) domain.TVSeriesPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	videos, err := s.listAllTVVideos()
	if err != nil {
		return domain.TVSeriesPage{
			Items:      []domain.TVSeriesSummary{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	rows := buildTVSeriesSummaries(videos, s.cfg.TVMediaRoot)
	rows = filterTVSeriesSummaries(rows, query)
	sortTVSeriesSummaries(rows, sortYear, sortOrder)

	total := len(rows)
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	start := (page - 1) * pageSize
	if start >= total {
		return domain.TVSeriesPage{
			Items:      []domain.TVSeriesSummary{},
			Total:      total,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
		}
	}

	end := start + pageSize
	if end > total {
		end = total
	}

	return domain.TVSeriesPage{
		Items:      rows[start:end],
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

func (s *Service) VersionInfo() domain.VersionInfo {
	return domain.VersionInfo{Version: version.Value}
}

func (s *Service) GetVideo(videoID string) (domain.Video, bool) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, false
	}
	return video, found
}

func (s *Service) UploadSubtitle(videoID string, file multipart.File, header *multipart.FileHeader, label string, replaceID string) (domain.Subtitle, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !subtitle.IsValidExtension(ext) {
		return domain.Subtitle{}, ErrInvalidFileType
	}

	targetPath := ""
	backupPath := ""
	action := "upload"
	replaceSourcePath := ""

	if replaceID != "" {
		existing, found := findSubtitle(video.Subtitles, replaceID)
		if !found {
			return domain.Subtitle{}, ErrNotFound
		}
		if !s.isWithinMediaRoots(existing.Path) {
			return domain.Subtitle{}, ErrUnsafePath
		}
		replaceSourcePath = existing.Path
		var err error
		backupPath, err = subtitle.BackupFile(existing.Path)
		if err != nil {
			return domain.Subtitle{}, fmt.Errorf("backup before replace failed: %w", err)
		}

		targetPath = subtitle.BuildReplacementSubtitlePath(existing.Path, ext)
		if !sameFilePath(targetPath, existing.Path) && subtitle.PathExists(targetPath) {
			return domain.Subtitle{}, fmt.Errorf("%w: subtitle path conflict: %s", ErrBadRequest, filepath.Base(targetPath))
		}
		action = "replace"
	} else {
		var err error
		targetPath, err = subtitle.BuildNewSubtitlePath(video.Path, label, ext)
		if err != nil {
			return domain.Subtitle{}, err
		}
	}

	if !s.isWithinMediaRoots(targetPath) {
		return domain.Subtitle{}, ErrUnsafePath
	}
	if err := subtitle.WriteUploadedFile(file, targetPath); err != nil {
		return domain.Subtitle{}, err
	}
	if replaceSourcePath != "" && !sameFilePath(targetPath, replaceSourcePath) {
		if err := os.Remove(replaceSourcePath); err != nil {
			return domain.Subtitle{}, fmt.Errorf("cleanup replaced subtitle failed: %w", err)
		}
	}

	updatedVideo, updatedSub, err := s.refreshVideoSubtitles(videoID, targetPath)
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
	})

	return updatedSub, nil
}

func (s *Service) DeleteSubtitle(videoID string, subtitleID string) error {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return ErrNotFound
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return ErrNotFound
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return ErrUnsafePath
	}

	if err := os.Remove(existing.Path); err != nil {
		return err
	}

	_, _, err := s.refreshVideoSubtitles(videoID, "")
	if err != nil {
		return err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("delete-%s-%d", existing.Path, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     "delete",
		VideoID:    videoID,
		TargetPath: existing.Path,
		Status:     "ok",
	})
	return nil
}

func (s *Service) ReadSubtitleContent(videoID string, subtitleID string) ([]byte, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return nil, ErrNotFound
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return nil, ErrNotFound
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return nil, ErrUnsafePath
	}

	data, err := os.ReadFile(existing.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return data, nil
}

func (s *Service) ListLogsPage(page int, pageSize int) domain.OperationLogPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = defaultLogPageSize
	}
	if pageSize > 200 {
		pageSize = 200
	}

	logs, total, err := s.store.ListLogs(page, pageSize)
	if err != nil {
		return domain.OperationLogPage{
			Items:      []domain.OperationLog{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return domain.OperationLogPage{
		Items:      logs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

func (s *Service) ListLogs(limit int) []domain.OperationLog {
	if limit <= 0 {
		limit = 50
	}
	return s.ListLogsPage(1, limit).Items
}

func (s *Service) ClearLogs() error {
	return s.store.ClearLogs()
}

func (s *Service) listAllTVVideos() ([]domain.Video, error) {
	return s.listAllVideosByType(domain.MediaTypeTV)
}

func (s *Service) listAllVideos() ([]domain.Video, error) {
	return s.listAllVideosByType("")
}

func (s *Service) listAllVideosByType(mediaType string) ([]domain.Video, error) {
	out := make([]domain.Video, 0, 256)
	page := 1
	pageSize := 200
	total := 0

	for {
		items, itemTotal, err := s.store.ListVideos("", mediaType, "", page, pageSize, "", "")
		if err != nil {
			return nil, err
		}
		if page == 1 {
			total = itemTotal
		}

		out = append(out, items...)
		if len(items) == 0 || len(out) >= total {
			break
		}
		page += 1
	}

	return out, nil
}

type videoChanges struct {
	Added   int
	Removed int
	Updated int
}

func calculateVideoChanges(before []domain.Video, current []domain.Video) videoChanges {
	beforeSignatures := make(map[string]string, len(before))
	for _, video := range before {
		beforeSignatures[video.ID] = videoContentSignature(video)
	}

	currentSignatures := make(map[string]string, len(current))
	for _, video := range current {
		currentSignatures[video.ID] = videoContentSignature(video)
	}

	changes := videoChanges{}
	for id, currentSig := range currentSignatures {
		beforeSig, ok := beforeSignatures[id]
		if !ok {
			changes.Added++
			continue
		}
		if beforeSig != currentSig {
			changes.Updated++
		}
	}
	for id := range beforeSignatures {
		if _, ok := currentSignatures[id]; !ok {
			changes.Removed++
		}
	}
	return changes
}

func videoContentSignature(video domain.Video) string {
	var b strings.Builder
	b.Grow(256)
	b.WriteString(strings.ToLower(strings.TrimSpace(video.Path)))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.Title))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.Year))
	b.WriteString("|")
	b.WriteString(strings.ToLower(strings.TrimSpace(video.MediaType)))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.MetadataSource))
	b.WriteString("|")
	b.WriteString(strings.ToLower(strings.TrimSpace(video.PosterPath)))

	subs := append([]domain.Subtitle(nil), video.Subtitles...)
	sort.Slice(subs, func(i int, j int) bool {
		if !strings.EqualFold(subs[i].Path, subs[j].Path) {
			return strings.ToLower(subs[i].Path) < strings.ToLower(subs[j].Path)
		}
		return strings.ToLower(subs[i].FileName) < strings.ToLower(subs[j].FileName)
	})
	for _, sub := range subs {
		b.WriteString("|")
		b.WriteString(strings.ToLower(strings.TrimSpace(sub.Path)))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.FileName))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Language))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Format))
		b.WriteString(":")
		b.WriteString(strconv.FormatInt(sub.Size, 10))
		b.WriteString(":")
		b.WriteString(sub.ModTime.UTC().Format(time.RFC3339Nano))
	}
	return b.String()
}

func buildTVSeriesSummaries(videos []domain.Video, tvRootPath string) []domain.TVSeriesSummary {
	type group struct {
		item        domain.TVSeriesSummary
		latestYear  int
		updatedTime time.Time
	}
	bySeries := make(map[string]*group, 128)

	for _, video := range videos {
		key, seriesPath, seriesTitle := resolveTVSeriesFromVideo(video, tvRootPath)
		item, ok := bySeries[key]
		if !ok {
			item = &group{
				item: domain.TVSeriesSummary{
					Key:             key,
					Path:            seriesPath,
					Title:           seriesTitle,
					UpdatedAt:       video.UpdatedAt.UTC().Format(time.RFC3339Nano),
					VideoCount:      0,
					NoSubtitleCount: 0,
				},
				latestYear:  0,
				updatedTime: video.UpdatedAt.UTC(),
			}
			bySeries[key] = item
		}

		item.item.VideoCount += 1
		if len(video.Subtitles) == 0 {
			item.item.NoSubtitleCount += 1
		}
		if item.item.PosterVideoID == "" && strings.TrimSpace(video.PosterPath) != "" {
			item.item.PosterVideoID = video.ID
		}

		if year := parseYearNumber(video.Year); year > item.latestYear {
			item.latestYear = year
			item.item.LatestEpisodeYear = strconv.Itoa(year)
		}

		if video.UpdatedAt.After(item.updatedTime) {
			item.updatedTime = video.UpdatedAt.UTC()
			item.item.UpdatedAt = video.UpdatedAt.UTC().Format(time.RFC3339Nano)
		}
	}

	rows := make([]domain.TVSeriesSummary, 0, len(bySeries))
	for _, row := range bySeries {
		rows = append(rows, row.item)
	}
	return rows
}

func filterTVSeriesSummaries(items []domain.TVSeriesSummary, query string) []domain.TVSeriesSummary {
	needle := strings.TrimSpace(strings.ToLower(query))
	if needle == "" {
		return items
	}

	filtered := make([]domain.TVSeriesSummary, 0, len(items))
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.Title), needle) || strings.Contains(strings.ToLower(item.Path), needle) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func sortTVSeriesSummaries(items []domain.TVSeriesSummary, _ string, sortOrder string) {
	order := normalizeSortOrder(sortOrder)

	sort.Slice(items, func(i int, j int) bool {
		yearA := parseYearNumber(items[i].LatestEpisodeYear)
		yearB := parseYearNumber(items[j].LatestEpisodeYear)
		hasYearA := yearA > 0
		hasYearB := yearB > 0

		if hasYearA != hasYearB {
			return hasYearA
		}
		if hasYearA && hasYearB && yearA != yearB {
			if order == "asc" {
				return yearA < yearB
			}
			return yearA > yearB
		}

		titleA := strings.ToLower(items[i].Title)
		titleB := strings.ToLower(items[j].Title)
		if titleA != titleB {
			return titleA < titleB
		}
		return strings.ToLower(items[i].Path) < strings.ToLower(items[j].Path)
	})
}

func resolveTVSeriesFromVideo(video domain.Video, tvRootPath string) (string, string, string) {
	videoDir := strings.TrimSpace(video.Directory)
	if videoDir == "" {
		videoDir = filepath.Dir(video.Path)
	}
	seriesPath := filepath.Clean(videoDir)
	seriesTitle := filepath.Base(seriesPath)
	if seriesTitle == "" || seriesTitle == "." || seriesTitle == string(filepath.Separator) {
		seriesTitle = strings.TrimSpace(video.Title)
	}
	if seriesTitle == "" {
		seriesTitle = "Unknown"
	}

	root := strings.TrimSpace(tvRootPath)
	if root != "" {
		rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(videoDir))
		if err == nil {
			rel = filepath.ToSlash(rel)
			if rel != "." && rel != ".." && !strings.HasPrefix(rel, "../") {
				parts := strings.Split(rel, "/")
				if len(parts) > 0 && strings.TrimSpace(parts[0]) != "" {
					seriesTitle = parts[0]
					seriesPath = filepath.Join(filepath.Clean(root), seriesTitle)
				}
			}
		}
	}

	key := tvSeriesKeyFromPath(seriesPath, seriesTitle)
	return key, seriesPath, seriesTitle
}

func tvSeriesKeyFromPath(seriesPath string, seriesTitle string) string {
	key := strings.ToLower(filepath.ToSlash(filepath.Clean(seriesPath)))
	if key == "" {
		return strings.ToLower(seriesTitle)
	}
	return key
}

func computeTVSeriesKeyFromDir(videoDir string, tvRootPath string) string {
	if strings.TrimSpace(videoDir) == "" {
		return ""
	}
	seriesPath := filepath.Clean(videoDir)
	root := strings.TrimSpace(tvRootPath)
	if root != "" {
		rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(videoDir))
		if err == nil {
			rel = filepath.ToSlash(rel)
			if rel != "." && rel != ".." && !strings.HasPrefix(rel, "../") {
				parts := strings.Split(rel, "/")
				if len(parts) > 0 && strings.TrimSpace(parts[0]) != "" {
					seriesPath = filepath.Join(filepath.Clean(root), parts[0])
				}
			}
		}
	}
	return tvSeriesKeyFromPath(seriesPath, filepath.Base(seriesPath))
}

func parseYearNumber(raw string) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0
	}
	year, err := strconv.Atoi(trimmed)
	if err != nil || year <= 0 {
		return 0
	}
	return year
}

func normalizeSortOrder(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "asc":
		return "asc"
	default:
		return "desc"
	}
}

func (s *Service) refreshVideoSubtitles(videoID string, targetPath string) (domain.Video, domain.Subtitle, error) {
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

func (s *Service) resolveDirectoriesForType(mediaType string, requested []string) ([]string, error) {
	root := filepath.Clean(s.rootByMediaType(mediaType))
	if root == "" {
		return nil, fmt.Errorf("unknown media type: %s", mediaType)
	}

	if len(requested) == 0 {
		if mediaType == domain.MediaTypeTV && strings.EqualFold(filepath.Clean(s.cfg.MovieMediaRoot), filepath.Clean(s.cfg.TVMediaRoot)) {
			return []string{}, nil
		}
		return []string{root}, nil
	}

	seen := make(map[string]struct{}, len(requested))
	out := make([]string, 0, len(requested))
	warnings := make([]string, 0, 4)
	for _, raw := range requested {
		if strings.TrimSpace(raw) == "" {
			continue
		}

		abs, err := filepath.Abs(raw)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", raw, err))
			continue
		}
		abs = filepath.Clean(abs)
		if !subtitle.EnsureWithinRoot(root, abs) {
			warnings = append(warnings, fmt.Sprintf("%s (outside %s root)", raw, mediaType))
			continue
		}

		info, err := os.Stat(abs)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", abs, err))
			continue
		}
		if !info.IsDir() {
			warnings = append(warnings, fmt.Sprintf("%s is not a directory", abs))
			continue
		}

		key := strings.ToLower(abs)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, abs)
	}

	if len(out) == 0 {
		if len(warnings) > 0 {
			return nil, fmt.Errorf("no valid %s directories (%s)", mediaType, strings.Join(warnings, "; "))
		}
		return nil, fmt.Errorf("no valid %s directories", mediaType)
	}
	if len(warnings) > 0 {
		return out, fmt.Errorf("some %s directories were skipped: %s", mediaType, strings.Join(warnings, "; "))
	}
	return out, nil
}

func (s *Service) rootByMediaType(mediaType string) string {
	if strings.EqualFold(mediaType, domain.MediaTypeTV) {
		return s.cfg.TVMediaRoot
	}
	return s.cfg.MovieMediaRoot
}

func (s *Service) setLastDirectoryScan(result domain.DirectoryScanResult) {
	s.dirScanMu.Lock()
	defer s.dirScanMu.Unlock()
	s.lastDirScan = cloneDirectoryScanResult(result)
}

func cloneDirectoryScanResult(result domain.DirectoryScanResult) domain.DirectoryScanResult {
	cloned := result
	cloned.Movie = append([]domain.ScanDirectory(nil), result.Movie...)
	cloned.TV = append([]domain.ScanDirectory(nil), result.TV...)
	cloned.Errors = append([]string(nil), result.Errors...)
	return cloned
}

func (s *Service) populateDirectoryScanCounts(result *domain.DirectoryScanResult) {
	if result == nil {
		return
	}

	result.MovieCount = s.ListVideosPage("", domain.MediaTypeMovie, "", 1, 1, "", "").Total
	result.TVSeriesCount = s.countTVSeries()
}

func (s *Service) countTVSeries() int {
	dirs, err := s.store.ListVideoDirectories(domain.MediaTypeTV)
	if err != nil {
		return 0
	}
	tvRoot := strings.TrimSpace(s.cfg.TVMediaRoot)
	seen := make(map[string]struct{}, len(dirs))
	for _, dir := range dirs {
		key := computeTVSeriesKeyFromDir(dir, tvRoot)
		if key == "" {
			continue
		}
		seen[key] = struct{}{}
	}
	return len(seen)
}

func prefixedError(prefix string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", prefix, err)
}

func combineErrors(errs ...error) error {
	parts := make([]string, 0, len(errs))
	for _, err := range errs {
		if err == nil {
			continue
		}
		parts = append(parts, err.Error())
	}
	if len(parts) == 0 {
		return nil
	}
	return errors.New(strings.Join(parts, "; "))
}

func sameFilePath(a string, b string) bool {
	left := filepath.Clean(strings.TrimSpace(a))
	right := filepath.Clean(strings.TrimSpace(b))
	return strings.EqualFold(left, right)
}

func ensureDirectoryWritable(root string) error {
	file, err := os.CreateTemp(root, ".subtitle-ui-write-check-*")
	if err != nil {
		return err
	}

	name := file.Name()
	closeErr := file.Close()
	removeErr := os.Remove(name)
	return combineErrors(closeErr, removeErr)
}

func uniqueCleanPaths(paths ...string) []string {
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, raw := range paths {
		pathValue := filepath.Clean(strings.TrimSpace(raw))
		if pathValue == "" {
			continue
		}
		key := strings.ToLower(pathValue)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, pathValue)
	}
	return out
}
