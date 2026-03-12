package config

import (
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	ServerAddr     string
	MovieMediaRoot string
	TVMediaRoot    string
	UIDist         string
	DBPath         string
}

func Load() Config {
	legacyRoot := strings.TrimSpace(os.Getenv("MEDIA_ROOT"))
	movieDefault := "./media/movies"
	tvDefault := "./media/tv"
	if legacyRoot != "" {
		movieDefault = legacyRoot
		tvDefault = legacyRoot
	}

	cfg := Config{
		ServerAddr:     getEnv("SERVER_ADDR", ":9307"),
		MovieMediaRoot: getEnv("MOVIE_MEDIA_ROOT", movieDefault),
		TVMediaRoot:    getEnv("TV_MEDIA_ROOT", tvDefault),
		UIDist:         getEnv("UI_DIST", "./frontend/out"),
		DBPath:         getEnv("DB_PATH", "./tmp/subtitle_manager.sqlite3"),
	}

	if abs, err := filepath.Abs(cfg.MovieMediaRoot); err == nil {
		cfg.MovieMediaRoot = abs
	}
	if abs, err := filepath.Abs(cfg.TVMediaRoot); err == nil {
		cfg.TVMediaRoot = abs
	}
	if abs, err := filepath.Abs(cfg.UIDist); err == nil {
		cfg.UIDist = abs
	}
	if abs, err := filepath.Abs(cfg.DBPath); err == nil {
		cfg.DBPath = abs
	}

	return cfg
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
