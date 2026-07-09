package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

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
		videos        []domain.Video
		replaceScopes []string
		fullLibrary   bool
		err           error
	}
	done := make(chan scanResult, 1)
	go func() {
		movieTargets, movieResolveErr := s.resolveDirectoriesForType(domain.MediaTypeMovie, movieDirs)
		tvTargets, tvResolveErr := s.resolveDirectoriesForType(domain.MediaTypeTV, tvDirs)
		fullLibrary := len(movieDirs) == 0 && len(tvDirs) == 0
		replaceScopes := mergeScanScopes(movieTargets, tvTargets)
		if fullLibrary {
			// Empty scopes means full-library replace in the store.
			replaceScopes = nil
		}

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
			videos:        result,
			replaceScopes: replaceScopes,
			fullLibrary:   fullLibrary,
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
	// Only refuse empty full-library scans. Partial scans may legitimately find
	// zero videos under the selected directories without wiping the rest of the DB.
	if !canceled && result.err == nil && result.fullLibrary && len(result.videos) == 0 && len(beforeVideos) > 0 {
		wipeGuardTripped = true
		result.err = fmt.Errorf(
			"scan returned no videos but previous scan had %d; refusing to overwrite database (check media root access)",
			len(beforeVideos),
		)
	}

	var saveErr error
	if !canceled {
		saveErr = s.store.SaveScanResult(result.videos, started, finished, errorString(result.err), result.replaceScopes)
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

func mergeScanScopes(scopes ...[]string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0)
	for _, group := range scopes {
		for _, scope := range group {
			cleaned := filepath.Clean(strings.TrimSpace(scope))
			if cleaned == "" || cleaned == "." {
				continue
			}
			key := strings.ToLower(cleaned)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, cleaned)
		}
	}
	return out
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
