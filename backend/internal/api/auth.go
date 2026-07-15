package api

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

func (s *Server) withAdminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.adminToken == "" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		path := r.URL.Path
		if !strings.HasPrefix(path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		if isPublicAPIPath(r.Method, path) {
			next.ServeHTTP(w, r)
			return
		}
		if !s.authorized(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isPublicAPIPath allows unauthenticated access for health probes and poster
// images (browser <img> cannot send Authorization headers).
func isPublicAPIPath(method, path string) bool {
	if method == http.MethodGet && path == "/api/health" {
		return true
	}
	if method == http.MethodGet && strings.HasPrefix(path, "/api/videos/") && strings.HasSuffix(path, "/poster") {
		// /api/videos/{id}/poster only (reject deeper or odd paths).
		rest := strings.TrimPrefix(path, "/api/videos/")
		parts := strings.Split(rest, "/")
		return len(parts) == 2 && parts[0] != "" && parts[1] == "poster"
	}
	return false
}

func (s *Server) authorized(r *http.Request) bool {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return false
	}
	token := strings.TrimSpace(header[len(prefix):])
	expected := s.adminToken
	if len(token) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(expected)) == 1
}
