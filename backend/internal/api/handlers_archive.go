package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"subtitle-ui/backend/internal/app"
)

func (s *Server) handleArchiveSubtitleEntries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
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

	entries, err := s.service.ListArchiveSubtitleEntries(file, header)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s *Server) handleArchiveExtract(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
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

	entry := strings.TrimSpace(r.FormValue("entry"))
	if entry == "" {
		entry = strings.TrimSpace(r.FormValue("archiveEntry"))
	}
	fileName, data, err := s.service.ExtractArchiveSubtitle(file, header, entry)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(fileName, `"`, "")+`"`)
	w.Header().Set("X-Subtitle-File-Name", fileName)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleBatchFromArchive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
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

	rawMappings := strings.TrimSpace(r.FormValue("mappings"))
	if rawMappings == "" {
		writeError(w, http.StatusBadRequest, "missing mappings field")
		return
	}
	var mappings []app.ArchiveBatchMapping
	if err := json.Unmarshal([]byte(rawMappings), &mappings); err != nil {
		writeError(w, http.StatusBadRequest, "invalid mappings json")
		return
	}

	result, err := s.service.BatchUploadFromArchive(file, header, mappings)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
