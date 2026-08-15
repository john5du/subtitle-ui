package api

import (
	"context"
	"net/http"
	"time"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	statusCode := http.StatusOK
	healthStatus := "ok"
	dbStatus := "ok"
	databaseReady := false
	pingCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if s.service == nil {
		statusCode = http.StatusServiceUnavailable
		healthStatus = "unavailable"
		dbStatus = "unavailable"
	} else if err := s.service.Ping(pingCtx); err != nil {
		statusCode = http.StatusServiceUnavailable
		healthStatus = "unavailable"
		dbStatus = "unavailable"
	} else {
		databaseReady = true
	}

	payload := map[string]any{
		"status":     healthStatus,
		"time":       time.Now().UTC(),
		"db":         dbStatus,
		"scanStatus": map[string]any{},
	}
	// ScanStatus reads from the database too, so only call it after a successful
	// bounded Ping; otherwise a health probe could block again on an outage.
	if databaseReady {
		payload["scanStatus"] = s.service.ScanStatus()
		if stats, ok := s.service.SubHDParseStats(); ok {
			payload["subhdParse"] = stats
		}
	}
	writeJSON(w, statusCode, payload)
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.service.VersionInfo())
}
