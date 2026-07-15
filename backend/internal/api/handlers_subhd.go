package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"subtitle-ui/backend/internal/app"
	appdomain "subtitle-ui/backend/internal/domain"
)

type subhdDownloadRequest struct {
	SID          string `json:"sid"`
	Label        string `json:"label"`
	ReplaceID    string `json:"replaceId"`
	ArchiveEntry string `json:"archiveEntry"`
}

type subhdSeasonPrepareRequest struct {
	SID                string   `json:"sid"`
	VideoIDs           []string `json:"videoIds"`
	Season             int      `json:"season"`
	LanguagePreference string   `json:"languagePreference"`
	FormatPreference   string   `json:"formatPreference"`
	SkipExisting       bool     `json:"skipExisting"`
	Label              string   `json:"label"`
}

type subhdSeasonInstallRequest struct {
	CacheToken string                    `json:"cacheToken"`
	Mappings   []app.ArchiveBatchMapping `json:"mappings"`
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
		Season:             req.Season,
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
