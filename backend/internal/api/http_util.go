package api

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"subtitle-ui/backend/internal/app"
)

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
	case errors.Is(err, app.ErrStreamTicketInvalid), errors.Is(err, app.ErrStreamTicketExpired):
		writeError(w, http.StatusUnauthorized, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func requestRemoteAddr(r *http.Request) string {
	if r == nil {
		return ""
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		if i := strings.IndexByte(forwarded, ','); i >= 0 {
			forwarded = strings.TrimSpace(forwarded[:i])
		}
		if forwarded != "" {
			return forwarded
		}
	}
	addr := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
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
