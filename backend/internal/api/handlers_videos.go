package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"
	"strings"

	"subtitle-ui/backend/internal/app"
	appdomain "subtitle-ui/backend/internal/domain"
)

type subtitleConvertRequest struct {
	TargetFormat   string `json:"targetFormat"`
	SourceEncoding string `json:"sourceEncoding"`
}

type subtitleTimingOffsetRequest struct {
	OffsetMS int `json:"offsetMs"`
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

	case len(segments) == 4 && segments[1] == "subtitles" && segments[2] == "normalize" && segments[3] == "plan" && r.Method == http.MethodPost:
		s.handleVideoNormalizePlan(w, r, videoID)
		return

	case len(segments) == 4 && segments[1] == "subtitles" && segments[2] == "normalize" && segments[3] == "apply" && r.Method == http.MethodPost:
		s.handleVideoNormalizeApply(w, r, videoID)
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

func (s *Server) handleVideoNormalizePlan(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	plan, err := s.service.PlanNormalizeVideoSubtitles(videoID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (s *Server) handleVideoNormalizeApply(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Items []appdomain.SubtitleNormalizeApplyItem `json:"items"`
	}
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if len(req.Items) == 0 {
		writeError(w, http.StatusBadRequest, "items required")
		return
	}
	result, err := s.service.ApplyNormalizeVideoSubtitles(videoID, req.Items)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
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
