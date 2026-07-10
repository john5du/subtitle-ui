package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	appdomain "subtitle-ui/backend/internal/domain"
)

type Server struct {
	service               *app.Service
	uiDist                string
	mux                   *http.ServeMux
	allowedOrigins        []string
	trustForwardedHeaders bool
}

type fileScanRequest struct {
	MovieDirs []string `json:"movieDirs"`
	TvDirs    []string `json:"tvDirs"`
}

type subtitleConvertRequest struct {
	TargetFormat   string `json:"targetFormat"`
	SourceEncoding string `json:"sourceEncoding"`
}

type subtitleTimingOffsetRequest struct {
	OffsetMS int `json:"offsetMs"`
}

type subhdDownloadRequest struct {
	SID          string `json:"sid"`
	Label        string `json:"label"`
	ReplaceID    string `json:"replaceId"`
	ArchiveEntry string `json:"archiveEntry"`
}

type subhdSeasonPrepareRequest struct {
	SID                string   `json:"sid"`
	VideoIDs           []string `json:"videoIds"`
	LanguagePreference string   `json:"languagePreference"`
	FormatPreference   string   `json:"formatPreference"`
	SkipExisting       bool     `json:"skipExisting"`
	Label              string   `json:"label"`
}

type subhdSeasonInstallRequest struct {
	CacheToken string                    `json:"cacheToken"`
	Mappings   []app.ArchiveBatchMapping `json:"mappings"`
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
	}

	s.mux.HandleFunc("/api/health", s.handleHealth)
	s.mux.HandleFunc("/api/scan", s.handleScan)
	s.mux.HandleFunc("/api/scan/directories", s.handleScanDirectories)
	s.mux.HandleFunc("/api/scan/files", s.handleScanFiles)
	s.mux.HandleFunc("/api/scan/status", s.handleScanStatus)
	s.mux.HandleFunc("/api/version", s.handleVersion)
	s.mux.HandleFunc("/api/config/subtitle-conversion", s.handleSubtitleConversionConfig)
	s.mux.HandleFunc("/api/config/subhd", s.handleSubHDConfig)
	s.mux.HandleFunc("/api/videos", s.handleVideos)
	s.mux.HandleFunc("/api/tv/series", s.handleTVSeries)
	s.mux.HandleFunc("/api/videos/", s.handleVideoRoute)
	s.mux.HandleFunc("/api/archives/subtitle-entries", s.handleArchiveSubtitleEntries)
	s.mux.HandleFunc("/api/archives/extract", s.handleArchiveExtract)
	s.mux.HandleFunc("/api/subtitles/batch-from-archive", s.handleBatchFromArchive)
	s.mux.HandleFunc("/api/subtitles/providers/subhd/season-prepare", s.handleSubHDSeasonPrepare)
	s.mux.HandleFunc("/api/subtitles/providers/subhd/season-install", s.handleSubHDSeasonInstall)
	s.mux.HandleFunc("/api/logs", s.handleLogs)
	s.mux.HandleFunc("/", s.handleUI)
	return s
}

func (s *Server) Handler() http.Handler {
	return s.withCORS(withErrorLogging(s.mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	status := s.service.ScanStatus()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"time":       time.Now().UTC(),
		"scanStatus": status,
	})
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	status := s.service.RunFileScan(r.Context(), nil, nil)
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleScanDirectories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		result := s.service.DiscoverDirectories(r.Context())
		writeJSON(w, http.StatusOK, result)
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.service.LastDirectoryScan())
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleScanFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	req := fileScanRequest{}
	if r.Body != nil && r.ContentLength != 0 {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json body")
			return
		}
	}

	status := s.service.RunFileScan(r.Context(), req.MovieDirs, req.TvDirs)
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleScanStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.service.ScanStatus())
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.service.VersionInfo())
}

func (s *Server) handleVideos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	query := r.URL.Query().Get("q")
	mediaType := r.URL.Query().Get("mediaType")
	directory := r.URL.Query().Get("dir")
	page := parsePositiveIntOrDefault(r.URL.Query().Get("page"), 1)
	pageSize := parsePositiveIntOrDefault(r.URL.Query().Get("pageSize"), 30)
	sortBy := r.URL.Query().Get("sortBy")
	sortOrder := r.URL.Query().Get("sortOrder")
	pageData := s.service.ListVideosPage(query, mediaType, directory, page, pageSize, sortBy, sortOrder)
	s.attachVideoPosterURLs(r, pageData.Items)
	writeJSON(w, http.StatusOK, pageData)
}

func (s *Server) handleTVSeries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := r.URL.Query().Get("q")
	page := parsePositiveIntOrDefault(r.URL.Query().Get("page"), 1)
	pageSize := parsePositiveIntOrDefault(r.URL.Query().Get("pageSize"), 30)
	sortYear := r.URL.Query().Get("sortYear")
	sortOrder := r.URL.Query().Get("sortOrder")
	pageData := s.service.ListTVSeriesPage(query, page, pageSize, sortYear, sortOrder)
	s.attachTVSeriesPosterURLs(r, pageData.Items)
	writeJSON(w, http.StatusOK, pageData)
}

func (s *Server) handleVideoRoute(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/videos/")
	trimmed = strings.Trim(trimmed, "/")
	if trimmed == "" {
		writeError(w, http.StatusNotFound, "video route not found")
		return
	}

	segments := strings.Split(trimmed, "/")
	videoID := segments[0]

	switch {
	case len(segments) == 1 && r.Method == http.MethodGet:
		video, ok := s.service.GetVideo(videoID)
		if !ok {
			writeError(w, http.StatusNotFound, "video not found")
			return
		}
		s.attachVideoPosterURL(r, &video)
		writeJSON(w, http.StatusOK, video)
		return

	case len(segments) == 2 && segments[1] == "poster" && r.Method == http.MethodGet:
		s.handleVideoPoster(w, r, videoID)
		return

	case len(segments) == 2 && segments[1] == "subtitles" && r.Method == http.MethodPost:
		s.handleUploadSubtitle(w, r, videoID)
		return

	case len(segments) == 5 && segments[1] == "subtitles" && segments[2] == "providers" && segments[3] == "subhd" && segments[4] == "search" && r.Method == http.MethodGet:
		s.handleSubHDSearch(w, r, videoID)
		return

	case len(segments) == 5 && segments[1] == "subtitles" && segments[2] == "providers" && segments[3] == "subhd" && segments[4] == "season-packs" && r.Method == http.MethodGet:
		s.handleSubHDSeasonPacks(w, r, videoID)
		return

	case len(segments) == 5 && segments[1] == "subtitles" && segments[2] == "providers" && segments[3] == "subhd" && segments[4] == "download" && r.Method == http.MethodPost:
		s.handleSubHDDownload(w, r, videoID)
		return

	case len(segments) == 4 && segments[1] == "subtitles" && segments[3] == "content" && r.Method == http.MethodGet:
		s.handleSubtitleContent(w, r, videoID, segments[2])
		return

	case len(segments) == 4 && segments[1] == "subtitles" && segments[3] == "convert" && r.Method == http.MethodPost:
		s.handleConvertSubtitle(w, r, videoID, segments[2])
		return

	case len(segments) == 5 && segments[1] == "subtitles" && segments[3] == "timing" && segments[4] == "offset" && r.Method == http.MethodPost:
		s.handleOffsetSubtitleTiming(w, r, videoID, segments[2])
		return

	case len(segments) == 3 && segments[1] == "subtitles" && r.Method == http.MethodDelete:
		err := s.service.DeleteSubtitle(videoID, segments[2])
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	default:
		writeError(w, http.StatusNotFound, "route not found")
		return
	}
}

func (s *Server) handleVideoPoster(w http.ResponseWriter, r *http.Request, videoID string) {
	posterPath, err := s.service.ResolveVideoPosterPath(videoID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}

	file, err := os.Open(posterPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "poster not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to open poster")
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat poster")
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	if !info.ModTime().IsZero() {
		w.Header().Set("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))
	}

	etag := makePosterETag(info)
	if etag != "" {
		w.Header().Set("ETag", etag)
		if headerMatchesETag(r.Header.Get("If-None-Match"), etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}

	http.ServeContent(w, r, path.Base(posterPath), info.ModTime(), file)
}

func (s *Server) handleSubHDSearch(w http.ResponseWriter, r *http.Request, videoID string) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	page := parsePositiveIntOrDefault(r.URL.Query().Get("page"), 1)
	result, err := s.service.SearchSubHD(r.Context(), videoID, app.SubHDSearchOptions{
		Query: query,
		Page:  page,
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSubHDSeasonPacks(w http.ResponseWriter, r *http.Request, videoID string) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	season := -1
	if raw := strings.TrimSpace(r.URL.Query().Get("season")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			season = n
		}
	}
	result, err := s.service.SearchSubHDSeasonPacks(r.Context(), videoID, app.SubHDSeasonPacksOptions{
		Query:  query,
		Season: season,
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSubHDDownload(w http.ResponseWriter, r *http.Request, videoID string) {
	var req subhdDownloadRequest
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	subtitle, err := s.service.InstallFromSubHD(r.Context(), videoID, req.SID, app.SubHDInstallOptions{
		Label:        strings.TrimSpace(req.Label),
		ReplaceID:    strings.TrimSpace(req.ReplaceID),
		ArchiveEntry: strings.TrimSpace(req.ArchiveEntry),
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, subtitle)
}

func (s *Server) handleUploadSubtitle(w http.ResponseWriter, r *http.Request, videoID string) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart body")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	label := strings.TrimSpace(r.FormValue("label"))
	replaceID := strings.TrimSpace(r.FormValue("replaceId"))
	convertTo := strings.TrimSpace(r.FormValue("convertTo"))
	sourceEncoding := strings.TrimSpace(r.FormValue("sourceEncoding"))
	archiveEntry := strings.TrimSpace(r.FormValue("archiveEntry"))

	subtitle, err := s.service.UploadSubtitleWithOptions(videoID, file, header, label, replaceID, app.SubtitleUploadOptions{
		ConvertTo:      convertTo,
		SourceEncoding: sourceEncoding,
		ArchiveEntry:   archiveEntry,
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, subtitle)
}

func (s *Server) handleArchiveSubtitleEntries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart body")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	entries, err := s.service.ListArchiveSubtitleEntries(file, header)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) handleArchiveExtract(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart body")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	entry := strings.TrimSpace(r.FormValue("entry"))
	if entry == "" {
		entry = strings.TrimSpace(r.FormValue("archiveEntry"))
	}
	fileName, data, err := s.service.ExtractArchiveSubtitle(file, header, entry)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(fileName, `"`, "")+`"`)
	w.Header().Set("X-Subtitle-File-Name", fileName)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleBatchFromArchive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart body")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	rawMappings := strings.TrimSpace(r.FormValue("mappings"))
	if rawMappings == "" {
		writeError(w, http.StatusBadRequest, "missing mappings field")
		return
	}
	var mappings []app.ArchiveBatchMapping
	if err := json.Unmarshal([]byte(rawMappings), &mappings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid mappings json")
		return
	}

	result, err := s.service.BatchUploadFromArchive(file, header, mappings)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSubHDSeasonPrepare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req subhdSeasonPrepareRequest
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	result, err := s.service.PrepareSubHDSeasonPack(r.Context(), app.SubHDSeasonPrepareOptions{
		SID:                strings.TrimSpace(req.SID),
		VideoIDs:           req.VideoIDs,
		LanguagePreference: strings.TrimSpace(req.LanguagePreference),
		FormatPreference:   strings.TrimSpace(req.FormatPreference),
		SkipExisting:       req.SkipExisting,
		Label:              strings.TrimSpace(req.Label),
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSubHDSeasonInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req subhdSeasonInstallRequest
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	result, err := s.service.InstallSubHDSeasonPack(r.Context(), app.SubHDSeasonInstallOptions{
		CacheToken: strings.TrimSpace(req.CacheToken),
		Mappings:   req.Mappings,
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSubtitleConversionConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.service.GetSubtitleConversionConfig()
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var req appdomain.SubtitleConversionConfigUpdate
		if r.Body != nil {
			defer r.Body.Close()
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json body")
			return
		}
		cfg, err := s.service.UpdateSubtitleConversionConfig(req)
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleSubHDConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.service.GetSubHDConfig()
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var req appdomain.SubHDConfigUpdate
		if r.Body != nil {
			defer r.Body.Close()
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json body")
			return
		}
		cfg, err := s.service.UpdateSubHDConfig(req)
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleConvertSubtitle(w http.ResponseWriter, r *http.Request, videoID string, subtitleID string) {
	req := subtitleConvertRequest{TargetFormat: "ass"}
	if r.Body != nil && r.ContentLength != 0 {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json body")
			return
		}
	}
	if strings.TrimSpace(req.TargetFormat) == "" {
		req.TargetFormat = "ass"
	}
	if !strings.EqualFold(strings.TrimSpace(req.TargetFormat), "ass") {
		writeError(w, http.StatusBadRequest, "unsupported conversion target")
		return
	}

	subtitle, err := s.service.ConvertSubtitleToASS(videoID, subtitleID, app.SubtitleConvertOptions{
		SourceEncoding: strings.TrimSpace(req.SourceEncoding),
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, subtitle)
}

func (s *Server) handleOffsetSubtitleTiming(w http.ResponseWriter, r *http.Request, videoID string, subtitleID string) {
	req := subtitleTimingOffsetRequest{}
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	subtitle, err := s.service.OffsetSubtitleTiming(videoID, subtitleID, app.SubtitleTimingOffsetOptions{
		OffsetMS: req.OffsetMS,
	})
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, subtitle)
}

func (s *Server) handleSubtitleContent(w http.ResponseWriter, _ *http.Request, videoID string, subtitleID string) {
	content, err := s.service.ReadSubtitleContent(videoID, subtitleID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		page := parsePositiveIntOrDefault(r.URL.Query().Get("page"), 1)
		pageSize := parsePositiveIntOrDefault(r.URL.Query().Get("pageSize"), 8)
		if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" && strings.TrimSpace(r.URL.Query().Get("pageSize")) == "" {
			pageSize = parsePositiveIntOrDefault(rawLimit, pageSize)
		}
		writeJSON(w, http.StatusOK, s.service.ListLogsPage(page, pageSize))
	case http.MethodDelete:
		if err := s.service.ClearLogs(); err != nil {
			writeError(w, http.StatusInternalServerError, "clear logs failed")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleUI(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	info, err := os.Stat(s.uiDist)
	if err != nil || !info.IsDir() {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("frontend is not built yet. Run `bun install && bun run build` in frontend/"))
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	filePath := filepath.Join(s.uiDist, filepath.FromSlash(cleanPath))
	if !withinDir(s.uiDist, filePath) {
		writeError(w, http.StatusForbidden, "invalid path")
		return
	}
	if existsFile(filePath) {
		http.ServeFile(w, r, filePath)
		return
	}

	indexPath := filepath.Join(s.uiDist, "index.html")
	if existsFile(indexPath) {
		http.ServeFile(w, r, indexPath)
		return
	}

	http.NotFound(w, r)
}

func (s *Server) writeAppError(w http.ResponseWriter, err error) {
	var multi *app.ArchiveMultipleEntriesError
	if errors.As(err, &multi) {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":   multi.Error(),
			"code":    "archive_multiple_entries",
			"entries": multi.Entries,
		})
		return
	}
	switch {
	case errors.Is(err, app.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, app.ErrProviderDisabled):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, app.ErrBadRequest), errors.Is(err, app.ErrInvalidFileType):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, app.ErrUnsafePath):
		writeError(w, http.StatusForbidden, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		isMutation := isMutatingMethod(r.Method)

		allowCORS := true
		switch {
		case origin == "":
			w.Header().Set("Access-Control-Allow-Origin", "*")
		case s.originAllowed(origin, r.Host):
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		case !isMutation:
			w.Header().Set("Access-Control-Allow-Origin", "*")
		default:
			allowCORS = false
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			if !allowCORS {
				writeError(w, http.StatusForbidden, "cross-origin request rejected")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if !allowCORS {
			writeError(w, http.StatusForbidden, "cross-origin write rejected")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isMutatingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func (s *Server) originAllowed(origin string, host string) bool {
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(parsed.Host, host) {
		return true
	}
	for _, allowed := range s.allowedOrigins {
		if allowed == "*" {
			return true
		}
		if strings.EqualFold(allowed, origin) {
			return true
		}
		if strings.EqualFold(allowed, parsed.Host) {
			return true
		}
	}
	return false
}

func normalizeAllowedOrigins(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

type errorCaptureResponseWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

const maxCapturedErrorBodyBytes = 512

func (w *errorCaptureResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *errorCaptureResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if w.status >= http.StatusBadRequest {
		if remaining := maxCapturedErrorBodyBytes - w.body.Len(); remaining > 0 {
			chunk := data
			if len(chunk) > remaining {
				chunk = chunk[:remaining]
			}
			_, _ = w.body.Write(chunk)
		}
	}
	return w.ResponseWriter.Write(data)
}

func withErrorLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured := &errorCaptureResponseWriter{ResponseWriter: w}
		next.ServeHTTP(captured, r)

		status := captured.status
		if status == 0 {
			status = http.StatusOK
		}
		if status < http.StatusBadRequest {
			return
		}

		errorMessage := parseErrorMessage(captured.body.Bytes())
		log.Printf(
			"api request failed: method=%s path=%s status=%d error=%q",
			r.Method,
			r.URL.Path,
			status,
			errorMessage,
		)
	})
}

func parseErrorMessage(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return ""
	}

	payload := map[string]any{}
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		if message, ok := payload["error"].(string); ok && strings.TrimSpace(message) != "" {
			return strings.TrimSpace(message)
		}
	}

	if len(trimmed) > 200 {
		return trimmed[:200] + "..."
	}
	return trimmed
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func (s *Server) attachVideoPosterURLs(r *http.Request, videos []appdomain.Video) {
	for i := range videos {
		s.attachVideoPosterURL(r, &videos[i])
	}
}

func (s *Server) attachVideoPosterURL(r *http.Request, video *appdomain.Video) {
	if video == nil || strings.TrimSpace(video.PosterPath) == "" {
		return
	}
	video.PosterURL = s.buildVideoPosterURL(r, video.ID)
}

func (s *Server) attachTVSeriesPosterURLs(r *http.Request, rows []appdomain.TVSeriesSummary) {
	for i := range rows {
		if strings.TrimSpace(rows[i].PosterVideoID) == "" {
			continue
		}
		rows[i].PosterURL = s.buildVideoPosterURL(r, rows[i].PosterVideoID)
	}
}

func (s *Server) buildVideoPosterURL(r *http.Request, videoID string) string {
	pathValue := "/api/videos/" + url.PathEscape(videoID) + "/poster"
	base := s.requestBaseURL(r)
	if base == "" {
		return pathValue
	}
	return base + pathValue
}

func (s *Server) requestBaseURL(r *http.Request) string {
	if r == nil {
		return ""
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if s.trustForwardedHeaders {
		if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
			scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
		if forwardedHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
			host = strings.TrimSpace(strings.Split(forwardedHost, ",")[0])
		}
	}
	if host == "" {
		return ""
	}

	return scheme + "://" + host
}

func makePosterETag(info os.FileInfo) string {
	if info == nil {
		return ""
	}
	return `W/"` + strconv.FormatInt(info.Size(), 10) + `-` + strconv.FormatInt(info.ModTime().UTC().UnixNano(), 10) + `"`
}

func headerMatchesETag(raw string, etag string) bool {
	if etag == "" {
		return false
	}
	for _, candidate := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "*" || trimmed == etag {
			return true
		}
	}
	return false
}

func existsFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func withinDir(root string, candidate string) bool {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	candidateAbs, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(rootAbs, candidateAbs)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != "..")
}

func parsePositiveIntOrDefault(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
