package config

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	ServerAddr            string
	MovieMediaRoot        string
	TVMediaRoot           string
	UIDist                string
	DBPath                string
	DatabaseURL           string
	CORSAllowedOrigins    []string
	TrustForwardedHeaders bool
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
		ServerAddr:            getEnv("SERVER_ADDR", ":9307"),
		MovieMediaRoot:        getEnv("MOVIE_MEDIA_ROOT", movieDefault),
		TVMediaRoot:           getEnv("TV_MEDIA_ROOT", tvDefault),
		UIDist:                getEnv("UI_DIST", "./frontend/out"),
		DBPath:                getEnv("DB_PATH", "./tmp/subtitle_manager.sqlite3"),
		DatabaseURL:           strings.TrimSpace(os.Getenv("DATABASE_URL")),
		CORSAllowedOrigins:    splitOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")),
		TrustForwardedHeaders: parseBool(os.Getenv("TRUST_FORWARDED_HEADERS")),
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

func splitOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func parseBool(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func RedactDatabaseURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err == nil && parsed.Scheme != "" {
		if parsed.User != nil {
			username := parsed.User.Username()
			if _, hasPassword := parsed.User.Password(); hasPassword {
				parsed.User = url.UserPassword(username, "xxxxx")
			} else {
				parsed.User = url.User(username)
			}
		}
		return parsed.String()
	}

	parts := strings.Fields(trimmed)
	for i, part := range parts {
		if strings.HasPrefix(strings.ToLower(part), "password=") {
			parts[i] = "password=xxxxx"
		}
	}
	return strings.Join(parts, " ")
}
