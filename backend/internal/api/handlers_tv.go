package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	appdomain "subtitle-ui/backend/internal/domain"
)

func (s *Server) handleTVSeries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := r.URL.Query().Get("q")
	page := parsePositiveIntOrDefault(r.URL.Query().Get("page"), 1)
	pageSize := parsePositiveIntOrDefault(r.URL.Query().Get("pageSize"), 30)
	sortBy := r.URL.Query().Get("sortBy")
	if sortBy == "" {
		sortBy = r.URL.Query().Get("sortYear")
	}
	sortOrder := r.URL.Query().Get("sortOrder")
	pageData, err := s.service.ListTVSeriesPage(query, page, pageSize, sortBy, sortOrder)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	s.attachTVSeriesPosterURLs(r, pageData.Items)
	writeJSON(w, http.StatusOK, pageData)
}

func (s *Server) handleTVSeriesCompleteness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	pathValue := strings.TrimSpace(r.URL.Query().Get("path"))
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	seasonRaw := strings.TrimSpace(r.URL.Query().Get("season"))
	if pathValue == "" && key == "" {
		writeError(w, http.StatusBadRequest, "path or key required")
		return
	}
	if seasonRaw == "" {
		writeError(w, http.StatusBadRequest, "season required")
		return
	}
	season, err := strconv.Atoi(seasonRaw)
	if err != nil || season < 0 {
		writeError(w, http.StatusBadRequest, "invalid season")
		return
	}
	result, err := s.service.GetSeasonCompleteness(r.Context(), pathValue, key, season)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleTVSeriesSonarrSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req appdomain.SonarrSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if strings.TrimSpace(req.Path) == "" && strings.TrimSpace(req.Key) == "" {
		writeError(w, http.StatusBadRequest, "path or key required")
		return
	}
	if req.Season < 0 {
		writeError(w, http.StatusBadRequest, "invalid season")
		return
	}
	result, err := s.service.SearchSonarrMissing(r.Context(), req)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleTVSeasonNormalizePlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req appdomain.TVSeasonNormalizeRequest
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if strings.TrimSpace(req.Path) == "" && strings.TrimSpace(req.Key) == "" {
		writeError(w, http.StatusBadRequest, "path or key required")
		return
	}
	if req.Season < 0 {
		writeError(w, http.StatusBadRequest, "invalid season")
		return
	}
	plan, err := s.service.PlanNormalizeSeasonSubtitles(req.Path, req.Key, req.Season)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (s *Server) handleTVSeasonNormalizeApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req appdomain.TVSeasonNormalizeRequest
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if strings.TrimSpace(req.Path) == "" && strings.TrimSpace(req.Key) == "" {
		writeError(w, http.StatusBadRequest, "path or key required")
		return
	}
	if req.Season < 0 {
		writeError(w, http.StatusBadRequest, "invalid season")
		return
	}
	if len(req.Items) == 0 {
		writeError(w, http.StatusBadRequest, "items required")
		return
	}
	result, err := s.service.ApplyNormalizeSeasonSubtitles(req.Path, req.Key, req.Season, req.Items)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
