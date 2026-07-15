package api

import (
	"net/http"
	"strings"
)

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
