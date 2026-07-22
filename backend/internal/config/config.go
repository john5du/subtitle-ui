package config

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultAdminToken is used when ADMIN_TOKEN is unset. Forbidden when IsProduction().
const DefaultAdminToken = "change-me"

type Config struct {
	ServerAddr            string
	MovieMediaRoot        string
	TVMediaRoot           string
	UIDist                string
	DBPath                string
	DatabaseURL           string
	CORSAllowedOrigins    []string
	TrustForwardedHeaders bool
	AdminToken            string
	AdminTokenIsDefault   bool
	SubHDEnabled          bool
	SubHDBaseURL          string
	SubHDUserAgent        string
	SubHDProxyURL         string
	SubHDMinInterval      time.Duration
	SubHDSearchMaxPages   int
	SonarrEnabled         bool
	SonarrURL             string
	SonarrAPIKey          string
	JellyfinEnabled       bool
	JellyfinURL           string
	JellyfinAPIKey        string
	JellyfinPathMap       string
	// JellyfinUserID optional GUID for PlaybackInfo (API key has no user claim). Empty → auto-pick.
	JellyfinUserID string
	// StreamTicketSecret signs short-lived video stream tickets. Empty → derive from AdminToken.
	StreamTicketSecret string
	// StreamTicketTTL is how long a stream ticket remains valid.
	StreamTicketTTL time.Duration
}

// IsProduction reports whether APP_ENV/ENV is production (or prod).
// Used to refuse insecure defaults such as the default admin token.
func IsProduction() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if env == "" {
		env = strings.ToLower(strings.TrimSpace(os.Getenv("ENV")))
	}
	return env == "production" || env == "prod"
}

func Load() Config {
	legacyRoot := strings.TrimSpace(os.Getenv("MEDIA_ROOT"))
	movieDefault := "./media/movies"
	tvDefault := "./media/tv"
	if legacyRoot != "" {
		// Legacy single-root: both movie and TV share MEDIA_ROOT.
		movieDefault = legacyRoot
		tvDefault = legacyRoot
	}

	adminToken := strings.TrimSpace(os.Getenv("ADMIN_TOKEN"))
	adminTokenIsDefault := false
	if adminToken == "" || adminToken == DefaultAdminToken {
		adminToken = DefaultAdminToken
		adminTokenIsDefault = true
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
		AdminToken:            adminToken,
		AdminTokenIsDefault:   adminTokenIsDefault,
		SubHDEnabled:          parseBoolDefaultTrue(os.Getenv("SUBHD_ENABLED")),
		SubHDBaseURL:          getEnv("SUBHD_BASE_URL", "https://subhd.tv"),
		SubHDUserAgent:        getEnv("SUBHD_USER_AGENT", ""),
		SubHDProxyURL:         strings.TrimSpace(os.Getenv("SUBHD_PROXY")),
		SubHDMinInterval:      parseDuration(os.Getenv("SUBHD_MIN_INTERVAL"), 3*time.Second),
		SubHDSearchMaxPages:   parsePositiveInt(os.Getenv("SUBHD_SEARCH_MAX_PAGES"), 1),
		SonarrURL:             strings.TrimRight(strings.TrimSpace(os.Getenv("SONARR_URL")), "/"),
		SonarrAPIKey:          strings.TrimSpace(os.Getenv("SONARR_API_KEY")),
		JellyfinURL:           strings.TrimRight(strings.TrimSpace(os.Getenv("JELLYFIN_URL")), "/"),
		JellyfinAPIKey:        strings.TrimSpace(os.Getenv("JELLYFIN_API_KEY")),
		JellyfinPathMap:       strings.TrimSpace(os.Getenv("JELLYFIN_PATH_MAP")),
		JellyfinUserID:        strings.TrimSpace(os.Getenv("JELLYFIN_USER_ID")),
		StreamTicketSecret:    strings.TrimSpace(os.Getenv("STREAM_TICKET_SECRET")),
		StreamTicketTTL:       parseDuration(os.Getenv("STREAM_TICKET_TTL"), 15*time.Minute),
	}

	// Sonarr: enabled when URL+key set, unless SONARR_ENABLED explicitly disables.
	if cfg.SonarrURL != "" && cfg.SonarrAPIKey != "" {
		cfg.SonarrEnabled = parseBoolDefaultTrue(os.Getenv("SONARR_ENABLED"))
	} else {
		cfg.SonarrEnabled = false
	}

	// Jellyfin: enabled when URL+key set, unless JELLYFIN_ENABLED explicitly disables.
	if cfg.JellyfinURL != "" && cfg.JellyfinAPIKey != "" {
		cfg.JellyfinEnabled = parseBoolDefaultTrue(os.Getenv("JELLYFIN_ENABLED"))
	} else {
		cfg.JellyfinEnabled = false
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

// Validate returns a non-nil error when the config is unsafe for the current environment.
func (c Config) Validate() error {
	if c.AdminTokenIsDefault && IsProduction() {
		return errDefaultAdminTokenInProduction
	}
	return nil
}

var errDefaultAdminTokenInProduction = &ConfigError{
	Message: "ADMIN_TOKEN must be set to a strong secret in production (default \"change-me\" is not allowed; set APP_ENV/ENV away from production for local dev)",
}

// ConfigError is a user-facing configuration problem.
type ConfigError struct {
	Message string
}

func (e *ConfigError) Error() string {
	if e == nil {
		return "config error"
	}
	return e.Message
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

// parseBoolDefaultTrue treats empty as true; only explicit false-like values disable.
func parseBoolDefaultTrue(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func parseDuration(raw string, fallback time.Duration) time.Duration {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	d, err := time.ParseDuration(trimmed)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

func parsePositiveInt(raw string, fallback int) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	n := 0
	for _, r := range trimmed {
		if r < '0' || r > '9' {
			return fallback
		}
		n = n*10 + int(r-'0')
	}
	if n <= 0 {
		return fallback
	}
	return n
}

// parseNonNegativeInt allows 0 (e.g. unlimited preview length); empty/invalid → fallback.
func parseNonNegativeInt(raw string, fallback int) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	n := 0
	for _, r := range trimmed {
		if r < '0' || r > '9' {
			return fallback
		}
		n = n*10 + int(r-'0')
	}
	return n
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
