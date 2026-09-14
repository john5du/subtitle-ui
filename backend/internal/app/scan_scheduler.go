package app

import (
	"context"
	"log"
	"strings"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
)

// StartScanScheduler begins the interval full-library scan loop (no-op when disabled).
// parent is canceled on process shutdown; config updates cancel only the loop.
func (s *Service) StartScanScheduler(parent context.Context) {
	if parent == nil {
		parent = context.Background()
	}
	s.scanSchedMu.Lock()
	s.scanSchedParent = parent
	s.scanSchedMu.Unlock()
	s.reloadScanScheduler()
}

func (s *Service) stopScanScheduler() {
	s.scanSchedMu.Lock()
	defer s.scanSchedMu.Unlock()
	if s.scanSchedCancel != nil {
		s.scanSchedCancel()
		s.scanSchedCancel = nil
	}
	s.scanSchedParent = nil
}

func (s *Service) reloadScanScheduler() {
	cfg, err := s.resolveScanConfig()
	if err != nil {
		log.Printf("scan scheduler: resolve config: %v", err)
		return
	}
	interval, _, err := parseScanInterval(cfg.Interval)
	if err != nil {
		interval = config.DefaultScanInterval
	}

	s.scanSchedMu.Lock()
	defer s.scanSchedMu.Unlock()
	if s.scanSchedCancel != nil {
		s.scanSchedCancel()
		s.scanSchedCancel = nil
	}
	parent := s.scanSchedParent
	if parent == nil || parent.Err() != nil || !cfg.Enabled {
		return
	}
	loopCtx, cancel := context.WithCancel(parent)
	s.scanSchedCancel = cancel
	go func(parent, loopCtx context.Context, interval time.Duration) {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		s.runScanSchedulerLoop(parent, loopCtx, ticker.C)
	}(parent, loopCtx, interval)
}

func (s *Service) runScanSchedulerLoop(parent, loopCtx context.Context, ticks <-chan time.Time) {
	for {
		select {
		case <-loopCtx.Done():
			return
		case <-ticks:
			if loopCtx.Err() != nil || parent.Err() != nil {
				return
			}
			s.runScheduledScan(parent)
		}
	}
}

func (s *Service) runScheduledScan(parent context.Context) domain.ScanStatus {
	scanCtx := WithOpAudit(parent, domain.OpSourceSystem, "auto_scan")
	status := s.RunScan(scanCtx)
	if strings.TrimSpace(status.Error) == "scan already running" {
		log.Printf("auto scan skipped: already running")
		return status
	}
	log.Printf("auto scan: videos=%d error=%q", status.VideoCount, status.Error)
	return status
}
