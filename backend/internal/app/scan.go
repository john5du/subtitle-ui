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
	"subtitle-ui/backend/internal/scanner"
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
	previousByPath := make(map[string]domain.Video, len(beforeVideos))
	for _, video := range beforeVideos {
		previousByPath[video.Path] = video
	}

	started := time.Now().UTC()
	s.scan.mu.Lock()
	s.scan.running = true
	s.scan.startedAt = &started
	s.scan.mu.Unlock()

	type scanResult struct {
		found         []domain.Video
		rebuilt       []domain.Video
		skipped       int
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

		found := make([]domain.Video, 0, 256)
		rebuilt := make([]domain.Video, 0, 64)
		skipped := 0

		var movieScanErr error
		if len(movieTargets) > 0 {
			movieResult, err := s.scanner.ScanDirectoriesIncrementalCtx(
				ctx,
				movieTargets,
				domain.MediaTypeMovie,
				previousByPath,
				s.resolveVideoScanFingerprint,
			)
			movieScanErr = err
			found = append(found, movieResult.Found...)
			skipped += movieResult.Stats.Skipped
			for _, video := range movieResult.Found {
				if _, ok := movieResult.Rebuilt[video.Path]; ok {
					rebuilt = append(rebuilt, video)
				}
			}
		}

		var tvScanErr error
		if len(tvTargets) > 0 {
			tvResult, err := s.scanner.ScanDirectoriesIncrementalCtx(
				ctx,
				tvTargets,
				domain.MediaTypeTV,
				previousByPath,
				s.resolveVideoScanFingerprint,
			)
			tvScanErr = err
			found = append(found, tvResult.Found...)
			skipped += tvResult.Stats.Skipped
			for _, video := range tvResult.Found {
				if _, ok := tvResult.Rebuilt[video.Path]; ok {
					rebuilt = append(rebuilt, video)
				}
			}
		}

		rebuilt = s.assignPosterPaths(rebuilt)
		for i := range rebuilt {
			fp, size, modTime, fpErr := s.resolveVideoScanFingerprint(rebuilt[i].Path, rebuilt[i].MediaType)
			if fpErr == nil {
				rebuilt[i].ScanFingerprint = fp
				rebuilt[i].FileSize = size
				rebuilt[i].FileModTime = modTime
			}
		}

		// Merge rebuilt (with poster/fingerprint) back into found for path completeness.
		rebuiltByPath := make(map[string]domain.Video, len(rebuilt))
		for _, video := range rebuilt {
			rebuiltByPath[video.Path] = video
		}
		for i, video := range found {
			if updated, ok := rebuiltByPath[video.Path]; ok {
				found[i] = updated
			}
		}

		done <- scanResult{
			found:         found,
			rebuilt:       rebuilt,
			skipped:       skipped,
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
	if !canceled && result.err == nil && result.fullLibrary && len(result.found) == 0 && len(beforeVideos) > 0 {
		wipeGuardTripped = true
		result.err = fmt.Errorf(
			"scan returned no videos but previous scan had %d; refusing to overwrite database (check media root access)",
			len(beforeVideos),
		)
	}

	var saveErr error
	if canceled {
		// Do not persist partial canceled walks as a successful reconcile.
	} else if wipeGuardTripped || result.err != nil {
		// Record the failed run without mutating library rows.
		// SaveScanReconcile also refuses mutation when scanErr is set (defense in depth).
		saveErr = s.store.SaveScanReconcile(nil, nil, started, finished, errorString(result.err), result.replaceScopes)
		if saveErr != nil {
			result.err = combineErrors(result.err, prefixedError("persist scan result", saveErr))
		}
	} else {
		saveErr = s.store.SaveScanReconcile(result.found, result.rebuilt, started, finished, "", result.replaceScopes)
		if saveErr != nil {
			result.err = combineErrors(result.err, prefixedError("persist scan result", saveErr))
		}
	}

	currentVideos, currentErr := s.listAllVideos()
	if currentErr != nil {
		result.err = combineErrors(result.err, prefixedError("load current videos", currentErr))
		currentVideos = result.found
	}

	changes := calculateVideoChanges(beforeVideos, currentVideos)
	scanMessage := fmt.Sprintf(
		"videos=%d added=%d removed=%d updated=%d skipped=%d",
		len(currentVideos),
		changes.Added,
		changes.Removed,
		changes.Updated,
		result.skipped,
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
	s.recordOpCtx(ctx, "scan", systemOperationVideoID, "", "", scanStatus, scanMessage)

	s.scan.mu.Lock()
	s.scan.running = false
	s.scan.mu.Unlock()

	status := s.ScanStatus()
	if result.err != nil {
		status.Error = result.err.Error()
	}
	return status
}

func (s *Service) resolveVideoScanFingerprint(videoPath string, mediaType string) (string, int64, time.Time, error) {
	posterPath := s.discoverPosterPathForScan(videoPath, mediaType)
	return scanner.ComputeMediaFingerprint(videoPath, mediaType, posterPath)
}

func (s *Service) discoverPosterPathForScan(videoPath string, mediaType string) string {
	absPath, err := filepath.Abs(videoPath)
	if err != nil {
		return ""
	}
	stub := domain.Video{
		Path:      absPath,
		Directory: filepath.Dir(absPath),
		FileName:  filepath.Base(absPath),
		MediaType: mediaType,
	}
	cache := make(map[string]string, 1)
	switch normalizePosterMediaType(mediaType) {
	case domain.MediaTypeTV:
		return s.findTVPosterPath(stub, cache)
	default:
		return s.findMoviePosterPath(stub, cache)
	}
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

	s.scan.mu.RLock()
	defer s.scan.mu.RUnlock()
	status.Running = s.scan.running
	if s.scan.running && s.scan.startedAt != nil {
		started := *s.scan.startedAt
		status.LastStartedAt = &started
	}
	return status
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
	// Partial invalid paths are skipped; do not return an error so a successful
	// scan of the remaining directories can still reconcile (hard failures still error).
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
