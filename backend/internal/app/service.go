package app

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
	"subtitle-ui/backend/internal/scanner"
	"subtitle-ui/backend/internal/store"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrBadRequest      = errors.New("bad request")
	ErrUnsafePath      = errors.New("unsafe path")
	ErrInvalidFileType = errors.New("invalid subtitle file extension")
	ErrProviderDisabled = errors.New("provider disabled")
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
)

type Service struct {
	cfg     config.Config
	scanner *scanner.Scanner
	store   *store.Store

	subhdMu        sync.RWMutex
	subhd          *subhd.Client
	subhdPackCache *subhdPackCache

	scanRunMu sync.Mutex

	statusMu      sync.RWMutex
	scanRunning   bool
	scanStartedAt *time.Time

	dirScanMu   sync.RWMutex
	lastDirScan domain.DirectoryScanResult
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
		subhd: subhd.New(subhd.Options{
			Enabled:     cfg.SubHDEnabled,
			BaseURL:     cfg.SubHDBaseURL,
			UserAgent:   cfg.SubHDUserAgent,
			ProxyURL:    cfg.SubHDProxyURL,
			MinInterval: cfg.SubHDMinInterval,
		}),
	}
	if err := svc.applyStoredSubHDConfig(); err != nil {
		_ = st.Close()
		return nil, err
	}
	return svc, nil
}

func (s *Service) subhdClient() *subhd.Client {
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
