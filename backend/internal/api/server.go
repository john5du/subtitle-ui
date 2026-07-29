package api

import (
	"net/http"
	"strings"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	mcpserver "subtitle-ui/backend/internal/mcp"
)

type Server struct {
	service               *app.Service
	uiDist                string
	mux                   *http.ServeMux
	allowedOrigins        []string
	trustForwardedHeaders bool
	adminToken            string
}

func NewServer(service *app.Service, uiDist string) *Server {
	return NewServerWithConfig(service, config.Config{UIDist: uiDist})
}

func NewServerWithConfig(service *app.Service, cfg config.Config) *Server {
	s := &Server{
		service:               service,
		uiDist:                cfg.UIDist,
		mux:                   http.NewServeMux(),
		allowedOrigins:        normalizeAllowedOrigins(cfg.CORSAllowedOrigins),
		trustForwardedHeaders: cfg.TrustForwardedHeaders,
		adminToken:            strings.TrimSpace(cfg.AdminToken),
	}

	s.mux.HandleFunc("/api/health", s.handleHealth)
	s.mux.HandleFunc("/api/scan/directories", s.handleScanDirectories)
	s.mux.HandleFunc("/api/scan/files", s.handleScanFiles)
	s.mux.HandleFunc("/api/scan/status", s.handleScanStatus)
	s.mux.HandleFunc("/api/version", s.handleVersion)
	s.mux.HandleFunc("/api/config/subtitle-conversion", s.handleSubtitleConversionConfig)
	s.mux.HandleFunc("/api/config/subhd", s.handleSubHDConfig)
	s.mux.HandleFunc("/api/config/sonarr", s.handleSonarrConfig)
	s.mux.HandleFunc("/api/config/sonarr/test", s.handleSonarrConfigTest)
	s.mux.HandleFunc("/api/config/jellyfin", s.handleJellyfinConfig)
	s.mux.HandleFunc("/api/config/jellyfin/test", s.handleJellyfinConfigTest)
	s.mux.HandleFunc("/api/config/mcp", s.handleMCPConfig)
	s.mux.HandleFunc("/api/videos", s.handleVideos)
	s.mux.HandleFunc("/api/tv/series", s.handleTVSeries)
	s.mux.HandleFunc("/api/tv/series/completeness", s.handleTVSeriesCompleteness)
	s.mux.HandleFunc("/api/tv/series/sonarr/search", s.handleTVSeriesSonarrSearch)
	s.mux.HandleFunc("/api/tv/series/subtitles/normalize/plan", s.handleTVSeasonNormalizePlan)
	s.mux.HandleFunc("/api/tv/series/subtitles/normalize/apply", s.handleTVSeasonNormalizeApply)
	s.mux.HandleFunc("/api/videos/", s.handleVideoRoute)
	s.mux.HandleFunc("/api/archives/subtitle-entries", s.handleArchiveSubtitleEntries)
	s.mux.HandleFunc("/api/archives/extract", s.handleArchiveExtract)
	s.mux.HandleFunc("/api/subtitles/batch-from-archive", s.handleBatchFromArchive)
	s.mux.HandleFunc("/api/subtitles/providers/subhd/season-prepare", s.handleSubHDSeasonPrepare)
	s.mux.HandleFunc("/api/subtitles/providers/subhd/season-install", s.handleSubHDSeasonInstall)
	s.mux.HandleFunc("/api/logs", s.handleLogs)
	// Streamable MCP always mounted; runtime gate is service.MCPEnabled() (default off).
	mcpHandler := s.withMCPEnabled(mcpserver.NewHTTPHandler(service))
	s.mux.Handle("/mcp", mcpHandler)
	s.mux.Handle("/mcp/", mcpHandler)
	s.mux.HandleFunc("/", s.handleUI)
	return s
}

func (s *Server) withMCPEnabled(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.service == nil || !s.service.MCPEnabled() {
			writeError(w, http.StatusServiceUnavailable, "mcp disabled")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Handler() http.Handler {
	return s.withCORS(withRequestLogging(s.withAdminAuth(s.mux)))
}
