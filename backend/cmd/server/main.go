package main

import (
	"context"
	"log"
	"net/http"
	"os"
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
	initialStatus := service.RunScan(context.Background())
	log.Printf("initial scan: videos=%d error=%q", initialStatus.VideoCount, initialStatus.Error)

	srv := &http.Server{
		Addr:              cfg.ServerAddr,
		Handler:           api.NewServer(service, cfg.UIDist).Handler(),
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
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server stopped: %v", err)
	}
}
