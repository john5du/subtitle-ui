package api

import (
	"net/http"
	"strings"
)

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/logs")
	path = strings.Trim(path, "/")
	if path != "" {
		// /api/logs/{id}/rollback
		parts := strings.Split(path, "/")
		if len(parts) == 2 && parts[1] == "rollback" && r.Method == http.MethodPost {
			s.handleLogRollback(w, r, parts[0])
			return
		}
		if len(parts) == 1 && r.Method == http.MethodGet {
			log, err := s.service.GetOperationLog(parts[0])
			if err != nil {
				s.writeAppError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, log)
			return
		}
		writeError(w, http.StatusNotFound, "not found")
		return
	}

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

func (s *Server) handleLogRollback(w http.ResponseWriter, r *http.Request, opID string) {
	result, err := s.service.RollbackOperation(opID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
