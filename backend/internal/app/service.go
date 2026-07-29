package app

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/jellyfin"
	"subtitle-ui/backend/internal/provider/sonarr"
	"subtitle-ui/backend/internal/provider/subhd"
	"subtitle-ui/backend/internal/scanner"
	"subtitle-ui/backend/internal/store"
)

var (
	ErrNotFound         = errors.New("not found")
	ErrBadRequest       = errors.New("bad request")
	ErrUnsafePath       = errors.New("unsafe path")
	ErrInvalidFileType  = errors.New("invalid subtitle file extension")
	ErrProviderDisabled = errors.New("provider disabled")
	// ErrPreviewUnavailable: Jellyfin cannot produce a browser-playable preview for this file.
	ErrPreviewUnavailable = errors.New("preview unavailable")
)

const (
	systemOperationVideoID = "SYSTEM"
	defaultLogPageSize     = 8
	settingASSTemplate     = "subtitle_conversion.ass_template"
	settingSourceEncoding  = "subtitle_conversion.source_encoding_default"
	settingSubHDEnabled    = "subhd.enabled"
	settingSubHDBaseURL    = "subhd.base_url"
	settingSubHDProxy      = "subhd.proxy"
	defaultSubHDBaseURL    = "https://subhd.tv"
	settingSonarrEnabled   = "sonarr.enabled"
	settingSonarrURL       = "sonarr.url"
	settingSonarrAPIKey    = "sonarr.api_key"
	settingJellyfinEnabled = "jellyfin.enabled"
	settingJellyfinURL     = "jellyfin.url"
	settingJellyfinAPIKey  = "jellyfin.api_key"
	settingJellyfinPathMap = "jellyfin.path_map"
	settingMCPEnabled      = "mcp.enabled"
)

type scanStatus struct {
	mu        sync.RWMutex
	running   bool
	startedAt *time.Time
}

type Service struct {
	cfg     config.Config
	scanner *scanner.Scanner
	store   *store.Store

	subhdMu        sync.RWMutex
	subhd          SubHDProvider
	subhdPackCache *subhdPackCache

	sonarrMu sync.RWMutex
	sonarr   *sonarr.Client

	jellyfinMu sync.RWMutex
	jellyfin   *jellyfin.Client

	scanRunMu sync.Mutex
	scan      scanStatus

	dirScanMu   sync.RWMutex
	lastDirScan domain.DirectoryScanResult

	// Per-video mutexes serialize subtitle disk+DB mutations.
	videoLocksMu sync.Mutex
	videoLocks   map[string]*sync.Mutex

	// mcpEnabled is hot-reloaded from DB (env bootstrap default false).
	mcpEnabled atomic.Bool
}

// SubHDParseStats returns HTML parse telemetry when the live SubHD client is in use.
func (s *Service) SubHDParseStats() (subhd.ParseStats, bool) {
	if s == nil {
		return subhd.ParseStats{}, false
	}
	s.subhdMu.RLock()
	provider := s.subhd
	s.subhdMu.RUnlock()
	type parseStatter interface {
		ParseStats() subhd.ParseStats
	}
	if st, ok := provider.(parseStatter); ok {
		return st.ParseStats(), true
	}
	return subhd.ParseStats{}, false
}

func NewService(cfg config.Config) (*Service, error) {
	st, err := store.OpenWithOptions(store.OpenOptions{
		SQLitePath:  cfg.DBPath,
		PostgresURL: cfg.DatabaseURL,
	})
	if err != nil {
		return nil, err
	}
	svc := &Service{
		cfg:            cfg,
		scanner:        scanner.New(),
		store:          st,
		subhdPackCache: newSubHDPackCache(),
		videoLocks:     make(map[string]*sync.Mutex),
		subhd: subhd.New(subhd.Options{
			Enabled:     cfg.SubHDEnabled,
			BaseURL:     cfg.SubHDBaseURL,
			UserAgent:   cfg.SubHDUserAgent,
			ProxyURL:    cfg.SubHDProxyURL,
			MinInterval: cfg.SubHDMinInterval,
		}),
		sonarr: sonarr.New(sonarr.Options{
			Enabled: cfg.SonarrEnabled,
			BaseURL: cfg.SonarrURL,
			APIKey:  cfg.SonarrAPIKey,
		}),
	}
	{
		var maps []jellyfin.PathMap
		if parsed, err := jellyfin.ParsePathMaps(cfg.JellyfinPathMap); err == nil {
			maps = parsed
		}
		svc.jellyfin = jellyfin.New(jellyfin.Options{
			Enabled:  cfg.JellyfinEnabled,
			BaseURL:  cfg.JellyfinURL,
			APIKey:   cfg.JellyfinAPIKey,
			UserID:   cfg.JellyfinUserID,
			PathMaps: maps,
		})
	}
	if err := svc.applyStoredSubHDConfig(); err != nil {
		_ = st.Close()
		return nil, err
	}
	if err := svc.applyStoredSonarrConfig(); err != nil {
		_ = st.Close()
		return nil, err
	}
	if err := svc.applyStoredJellyfinConfig(); err != nil {
		_ = st.Close()
		return nil, err
	}
	if err := svc.applyStoredMCPConfig(); err != nil {
		_ = st.Close()
		return nil, err
	}
	return svc, nil
}

// SonarrEnabled reports whether Sonarr integration is configured on.
func (s *Service) SonarrEnabled() bool {
	c := s.sonarrClient()
	return c != nil && c.Enabled()
}

func (s *Service) subhdClient() SubHDProvider {
	s.subhdMu.RLock()
	defer s.subhdMu.RUnlock()
	return s.subhd
}

// SubHDEnabled reports whether SubHD provider is configured on.
func (s *Service) SubHDEnabled() bool {
	c := s.subhdClient()
	return c != nil && c.Enabled()
}

func (s *Service) rebuildSubHDClient(enabled bool, baseURL, proxy string) {
	client := subhd.New(subhd.Options{
		Enabled:     enabled,
		BaseURL:     baseURL,
		UserAgent:   s.cfg.SubHDUserAgent,
		ProxyURL:    proxy,
		MinInterval: s.cfg.SubHDMinInterval,
	})
	s.subhdMu.Lock()
	s.subhd = client
	s.subhdMu.Unlock()
}

func (s *Service) Close() error {
	return s.store.Close()
}

// lockVideo returns a per-video mutex for subtitle mutations (create-on-first-use).
func (s *Service) lockVideo(videoID string) *sync.Mutex {
	videoID = strings.TrimSpace(videoID)
	s.videoLocksMu.Lock()
	defer s.videoLocksMu.Unlock()
	if s.videoLocks == nil {
		s.videoLocks = make(map[string]*sync.Mutex)
	}
	if mu, ok := s.videoLocks[videoID]; ok {
		return mu
	}
	mu := &sync.Mutex{}
	s.videoLocks[videoID] = mu
	return mu
}

func (s *Service) CheckMediaRootWritePermissions() []string {
	roots := uniqueCleanPaths(s.cfg.MovieMediaRoot, s.cfg.TVMediaRoot)
	issues := make([]string, 0, len(roots))
	for _, root := range roots {
		if err := ensureDirectoryWritable(root); err != nil {
			msg := fmt.Sprintf("media root %s is not writable: %v", root, err)
			issues = append(issues, msg)
			s.recordOp("permission_check", systemOperationVideoID, root, "", "error", msg)
		}
	}
	return issues
}
