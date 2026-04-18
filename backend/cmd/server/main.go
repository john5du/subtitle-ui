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
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("subtitle manager api listening on %s", cfg.ServerAddr)
	log.Printf("version: %s", version.Value)
	log.Printf("movie media root: %s", cfg.MovieMediaRoot)
	log.Printf("tv media root: %s", cfg.TVMediaRoot)
	log.Printf("db path: %s", cfg.DBPath)
	log.Printf("ui dist: %s", cfg.UIDist)

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
