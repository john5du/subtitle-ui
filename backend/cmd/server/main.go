package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"subtitle-ui/backend/internal/api"
	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/version"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	if err := os.MkdirAll(cfg.MovieMediaRoot, 0o755); err != nil {
		log.Fatalf("failed to create movie media root %q: %v", cfg.MovieMediaRoot, err)
	}
	if err := os.MkdirAll(cfg.TVMediaRoot, 0o755); err != nil {
		log.Fatalf("failed to create tv media root %q: %v", cfg.TVMediaRoot, err)
	}

	service, err := app.NewService(cfg)
	if err != nil {
		log.Fatalf("failed to init service: %v", err)
	}
	defer func() {
		if err := service.Close(); err != nil {
			log.Printf("failed to close service: %v", err)
		}
	}()

	permissionIssues := service.CheckMediaRootWritePermissions()
	if len(permissionIssues) == 0 {
		log.Printf("media root write permission check: ok")
	} else {
		for _, issue := range permissionIssues {
			log.Printf("media root write permission check failed: %s", issue)
		}
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	initialStatus := service.RunScan(rootCtx)
	log.Printf("initial scan: videos=%d error=%q", initialStatus.VideoCount, initialStatus.Error)

	srv := &http.Server{
		Addr:              cfg.ServerAddr,
		Handler:           api.NewServerWithConfig(service, cfg).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		// ReadTimeout left 0 so long-lived Range/stream GETs are not cut mid-transfer.
		// WriteTimeout 0: Jellyfin-proxied video stream (Range) may exceed a fixed cap.
		IdleTimeout: 120 * time.Second,
	}

	log.Printf("subtitle manager api listening on %s", cfg.ServerAddr)
	log.Printf("version: %s", version.Value)
	log.Printf("movie media root: %s", cfg.MovieMediaRoot)
	log.Printf("tv media root: %s", cfg.TVMediaRoot)
	if cfg.DatabaseURL != "" {
		log.Printf("database: postgres (%s)", config.RedactDatabaseURL(cfg.DatabaseURL))
		log.Printf("sqlite migration source: %s", cfg.DBPath)
	} else {
		log.Printf("database: sqlite")
		log.Printf("db path: %s", cfg.DBPath)
	}
	log.Printf("ui dist: %s", cfg.UIDist)
	if cfg.AdminTokenIsDefault {
		log.Printf("admin auth: using insecure default token %q (ALLOW_INSECURE_DEFAULT_ADMIN_TOKEN) — set ADMIN_TOKEN to a strong secret", cfg.AdminToken)
	} else {
		log.Printf("admin auth: enabled (token from ADMIN_TOKEN)")
	}
	if cfg.SonarrEnabled {
		log.Printf("sonarr: enabled (%s)", cfg.SonarrURL)
	} else {
		log.Printf("sonarr: disabled")
	}

	serverErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case <-rootCtx.Done():
		log.Printf("shutdown signal received, draining in-flight requests")
	case err := <-serverErr:
		if err != nil {
			log.Fatalf("server stopped: %v", err)
		}
		return
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	if err := <-serverErr; err != nil {
		log.Printf("server exited with error: %v", err)
	}
}
