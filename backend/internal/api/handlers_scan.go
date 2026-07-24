package api

import (
	"encoding/json"
	"net/http"
)

type fileScanRequest struct {
	MovieDirs []string `json:"movieDirs"`
	TvDirs    []string `json:"tvDirs"`
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
