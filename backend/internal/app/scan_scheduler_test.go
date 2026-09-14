package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func newScanSchedulerService(t *testing.T) *Service {
	t.Helper()
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot:  movieRoot,
		TVMediaRoot:     tvRoot,
		DatabaseURL:     store.TestDSN(t),
		ScanAutoEnabled: true,
		ScanInterval:    time.Hour,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestRunScheduledScanWritesSystemAudit(t *testing.T) {
	svc := newScanSchedulerService(t)

	status := svc.runScheduledScan(context.Background())
	if status.Error != "" {
		t.Fatalf("scheduled scan: %s", status.Error)
	}
	if status.VideoCount != 1 {
		t.Fatalf("videoCount=%d want 1", status.VideoCount)
	}

	item, ok := latestLogByAction(svc.ListLogs(20), "scan")
	if !ok {
		t.Fatal("expected scan log")
	}
	if item.Source != domain.OpSourceSystem || item.Tool != "auto_scan" {
		t.Fatalf("audit source=%q tool=%q", item.Source, item.Tool)
	}
}

func TestRunScheduledScanSkipsWhenBusy(t *testing.T) {
	svc := newScanSchedulerService(t)
	if status := svc.RunScan(context.Background()); status.Error != "" {
		t.Fatalf("seed scan: %s", status.Error)
	}
	before := len(svc.ListLogs(50))

	svc.scanRunMu.Lock()
	status := svc.runScheduledScan(context.Background())
	svc.scanRunMu.Unlock()

	if status.Error != "scan already running" {
		t.Fatalf("expected already running, got %q", status.Error)
	}
	after := svc.ListLogs(50)
	if len(after) != before {
		t.Fatalf("busy skip should not write logs, before=%d after=%d", before, len(after))
	}
}

func TestScanSchedulerLoopTicksAndStops(t *testing.T) {
	svc := newScanSchedulerService(t)
	parent, parentCancel := context.WithCancel(context.Background())
	defer parentCancel()
	loopCtx, loopCancel := context.WithCancel(parent)
	ticks := make(chan time.Time, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		svc.runScanSchedulerLoop(parent, loopCtx, ticks)
	}()

	ticks <- time.Now()
	deadline := time.Now().Add(5 * time.Second)
	for {
		item, ok := latestLogByAction(svc.ListLogs(20), "scan")
		if ok && item.Tool == "auto_scan" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for auto scan")
		}
		time.Sleep(20 * time.Millisecond)
	}

	loopCancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("loop did not stop")
	}
}

func TestScanSchedulerLoopIgnoresBufferedTickAfterCancel(t *testing.T) {
	svc := newScanSchedulerService(t)
	parent, parentCancel := context.WithCancel(context.Background())
	defer parentCancel()
	loopCtx, loopCancel := context.WithCancel(parent)
	loopCancel()
	ticks := make(chan time.Time, 1)
	ticks <- time.Now()
	svc.runScanSchedulerLoop(parent, loopCtx, ticks)
	if _, ok := latestLogByAction(svc.ListLogs(20), "scan"); ok {
		t.Fatal("canceled loop should not scan a buffered tick")
	}
}

func TestScanSchedulerStopsWhenDisabled(t *testing.T) {
	svc := newScanSchedulerService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc.StartScanScheduler(ctx)

	svc.scanSchedMu.Lock()
	started := svc.scanSchedCancel != nil
	svc.scanSchedMu.Unlock()
	if !started {
		t.Fatal("expected scheduler running")
	}

	if _, err := svc.UpdateScanConfig(domain.ScanConfigUpdate{Enabled: false, Interval: "1h"}); err != nil {
		t.Fatalf("disable: %v", err)
	}
	svc.scanSchedMu.Lock()
	stopped := svc.scanSchedCancel == nil
	svc.scanSchedMu.Unlock()
	if !stopped {
		t.Fatal("expected scheduler stopped after disable")
	}
}
