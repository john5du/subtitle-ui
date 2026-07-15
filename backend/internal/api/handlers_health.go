package api

import (
	"net/http"
	"time"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	status := s.service.ScanStatus()
	payload := map[string]any{
		"status":     "ok",
		"time":       time.Now().UTC(),
		"scanStatus": status,
	}
	if stats, ok := s.service.SubHDParseStats(); ok {
		payload["subhdParse"] = stats
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.service.VersionInfo())
}
