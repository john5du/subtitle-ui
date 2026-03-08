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
	"strings"
	"sync"
	"time"

	"subtitle/backend/internal/config"
	"subtitle/backend/internal/domain"
	"subtitle/backend/internal/scanner"
	"subtitle/backend/internal/store"
	"subtitle/backend/internal/subtitle"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrBadRequest      = errors.New("bad request")
	ErrUnsafePath      = errors.New("unsafe path")
	ErrInvalidFileType = errors.New("invalid subtitle file extension")
)

type Service struct {
	cfg     config.Config
	scanner *scanner.Scanner
	store   *store.Store

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

func (s *Service) RunScan(ctx context.Context) domain.ScanStatus {
	return s.RunFileScan(ctx, nil, nil)
}

func (s *Service) RunFileScan(ctx context.Context, movieDirs []string, tvDirs []string) domain.ScanStatus {
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
			movieVideos, err := s.scanner.ScanDirectoriesWithType(movieTargets, domain.MediaTypeMovie)
			movieScanErr = err
			result = append(result, movieVideos...)
		}

		var tvScanErr error
		if len(tvTargets) > 0 {
			tvVideos, err := s.scanner.ScanDirectoriesWithType(tvTargets, domain.MediaTypeTV)
			tvScanErr = err
			result = append(result, tvVideos...)
		}

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

	var result scanResult
	select {
	case <-ctx.Done():
		result = scanResult{err: ctx.Err()}
	case result = <-done:
	}

	finished := time.Now().UTC()
	saveErr := s.store.SaveScanResult(result.videos, started, finished, errorString(result.err))
	if saveErr != nil {
		result.err = combineErrors(result.err, prefixedError("persist scan result", saveErr))
	}

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
		GeneratedAt: time.Now().UTC(),
		MovieRoot:   movieRoot,
		TVRoot:      tvRoot,
		Movie:       []domain.ScanDirectory{},
		TV:          []domain.ScanDirectory{},
	}

	type discoverResult struct {
		dirs []domain.ScanDirectory
		err  error
	}

	movieCh := make(chan discoverResult, 1)
	tvCh := make(chan discoverResult, 1)

	go func() {
		dirs, err := s.scanner.DiscoverDirectories(movieRoot, domain.MediaTypeMovie)
		movieCh <- discoverResult{dirs: dirs, err: err}
	}()
	go func() {
		if strings.EqualFold(movieRoot, tvRoot) {
			tvCh <- discoverResult{dirs: []domain.ScanDirectory{}, err: nil}
			return
		}
		dirs, err := s.scanner.DiscoverDirectories(tvRoot, domain.MediaTypeTV)
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

	s.setLastDirectoryScan(result)
	return result
}

func (s *Service) LastDirectoryScan() domain.DirectoryScanResult {
	s.dirScanMu.RLock()
	defer s.dirScanMu.RUnlock()
	return cloneDirectoryScanResult(s.lastDirScan)
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

func (s *Service) ListVideosPage(query string, mediaType string, directory string, page int, pageSize int) domain.VideoPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	videos, total, err := s.store.ListVideos(query, mediaType, directory, page, pageSize)
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

	if replaceID != "" {
		existing, found := findSubtitle(video.Subtitles, replaceID)
		if !found {
			return domain.Subtitle{}, ErrNotFound
		}
		if !s.isWithinMediaRoots(existing.Path) {
			return domain.Subtitle{}, ErrUnsafePath
		}
		targetPath = existing.Path
		var err error
		backupPath, err = subtitle.BackupFile(existing.Path)
		if err != nil {
			return domain.Subtitle{}, fmt.Errorf("backup before replace failed: %w", err)
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

	backupPath, err := subtitle.BackupFile(existing.Path)
	if err != nil {
		return fmt.Errorf("backup before delete failed: %w", err)
	}
	if err := os.Remove(existing.Path); err != nil {
		return err
	}

	_, _, err = s.refreshVideoSubtitles(videoID, "")
	if err != nil {
		return err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("delete-%s-%d", existing.Path, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     "delete",
		VideoID:    videoID,
		TargetPath: existing.Path,
		BackupPath: backupPath,
		Status:     "ok",
	})
	return nil
}

func (s *Service) ListLogs(limit int) []domain.OperationLog {
	logs, err := s.store.ListLogs(limit)
	if err != nil {
		return []domain.OperationLog{}
	}
	return logs
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
