package api

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		isMutation := isMutatingMethod(r.Method)

		allowCORS := true
		switch {
		case origin == "":
			w.Header().Set("Access-Control-Allow-Origin", "*")
		case s.originAllowed(origin, r.Host):
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		case !isMutation:
			w.Header().Set("Access-Control-Allow-Origin", "*")
		default:
			allowCORS = false
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,HEAD")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
		w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type")

		if r.Method == http.MethodOptions {
			if !allowCORS {
				writeError(w, http.StatusForbidden, "cross-origin request rejected")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if !allowCORS {
			writeError(w, http.StatusForbidden, "cross-origin write rejected")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isMutatingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func (s *Server) originAllowed(origin string, host string) bool {
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(parsed.Host, host) {
		return true
	}
	for _, allowed := range s.allowedOrigins {
		if allowed == "*" {
			return true
		}
		if strings.EqualFold(allowed, origin) {
			return true
		}
		if strings.EqualFold(allowed, parsed.Host) {
			return true
		}
	}
	return false
}

func normalizeAllowedOrigins(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}
