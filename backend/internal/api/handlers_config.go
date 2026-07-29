package api

import (
	"encoding/json"
	"net/http"

	appdomain "subtitle-ui/backend/internal/domain"
)

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dest any) bool {
	if r.Body != nil {
		defer r.Body.Close()
	}
	if err := json.NewDecoder(r.Body).Decode(dest); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return false
	}
	return true
}

func (s *Server) handleSubtitleConversionConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.service.GetSubtitleConversionConfig()
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var req appdomain.SubtitleConversionConfigUpdate
		if r.Body != nil {
			defer r.Body.Close()
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json body")
			return
		}
		cfg, err := s.service.UpdateSubtitleConversionConfig(req)
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleSonarrConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.service.GetSonarrConfig()
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var req appdomain.SonarrConfigUpdate
		if !decodeJSONBody(w, r, &req) {
			return
		}
		cfg, err := s.service.UpdateSonarrConfig(req)
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleSonarrConfigTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req appdomain.SonarrConfigUpdate
	if !decodeJSONBody(w, r, &req) {
		return
	}
	result, err := s.service.TestSonarrConfig(r.Context(), req)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleJellyfinConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.service.GetJellyfinConfig()
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var req appdomain.JellyfinConfigUpdate
		if !decodeJSONBody(w, r, &req) {
			return
		}
		cfg, err := s.service.UpdateJellyfinConfig(req)
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleJellyfinConfigTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req appdomain.JellyfinConfigUpdate
	if !decodeJSONBody(w, r, &req) {
		return
	}
	result, err := s.service.TestJellyfinConfig(r.Context(), req)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleMCPConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg, err := s.service.GetMCPConfig()
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	case http.MethodPut:
		var req appdomain.MCPConfigUpdate
		if !decodeJSONBody(w, r, &req) {
			return
		}
		cfg, err := s.service.UpdateMCPConfig(req)
		if err != nil {
			s.writeAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, cfg)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
