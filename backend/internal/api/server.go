package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/app"
)

type Server struct {
	service *app.Service
	uiDist  string
	mux     *http.ServeMux
}

type fileScanRequest struct {
	MovieDirs []string `json:"movieDirs"`
	TvDirs    []string `json:"tvDirs"`
}

func NewServer(service *app.Service, uiDist string) *Server {
	s := &Server{
		service: service,
		uiDist:  uiDist,
		mux:     http.NewServeMux(),
	}

	s.mux.HandleFunc("/api/health", s.handleHealth)
	s.mux.HandleFunc("/api/scan", s.handleScan)
	s.mux.HandleFunc("/api/scan/directories", s.handleScanDirectories)
	s.mux.HandleFunc("/api/scan/files", s.handleScanFiles)
	s.mux.HandleFunc("/api/scan/status", s.handleScanStatus)
	s.mux.HandleFunc("/api/version", s.handleVersion)
	s.mux.HandleFunc("/api/videos", s.handleVideos)
	s.mux.HandleFunc("/api/tv/series", s.handleTVSeries)
	s.mux.HandleFunc("/api/videos/", s.handleVideoRoute)
	s.mux.HandleFunc("/api/logs", s.handleLogs)
	s.mux.HandleFunc("/", s.handleUI)
	return s
}

func (s *Server) Handler() http.Handler {
	return withCORS(withErrorLogging(s.mux))
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
	writeJSON(w, http.StatusOK, s.service.ListVideosPage(query, mediaType, directory, page, pageSize, sortBy, sortOrder))
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
	writeJSON(w, http.StatusOK, s.service.ListTVSeriesPage(query, page, pageSize, sortYear, sortOrder))
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
		writeJSON(w, http.StatusOK, video)
		return

	case len(segments) == 2 && segments[1] == "subtitles" && r.Method == http.MethodPost:
		s.handleUploadSubtitle(w, r, videoID)
		return

	case len(segments) == 4 && segments[1] == "subtitles" && segments[3] == "content" && r.Method == http.MethodGet:
		s.handleSubtitleContent(w, r, videoID, segments[2])
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

	subtitle, err := s.service.UploadSubtitle(videoID, file, header, label, replaceID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, subtitle)
}

func (s *Server) handleSubtitleContent(w http.ResponseWriter, _ *http.Request, videoID string, subtitleID string) {
	content, err := s.service.ReadSubtitleContent(videoID, subtitleID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	writeJSON(w, http.StatusOK, s.service.ListLogs(limit))
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
		_, _ = w.Write([]byte("frontend is not built yet. Run `npm install && npm run build` in frontend/"))
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
	switch {
	case errors.Is(err, app.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, app.ErrBadRequest), errors.Is(err, app.ErrInvalidFileType):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, app.ErrUnsafePath):
		writeError(w, http.StatusForbidden, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type errorCaptureResponseWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (w *errorCaptureResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *errorCaptureResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if len(data) > 0 {
		_, _ = w.body.Write(data)
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
