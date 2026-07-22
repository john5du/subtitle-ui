package api

import (
	"io"
	"log"
	"net/http"
	"strings"
)

func (s *Server) handleStreamTicket(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ticket, err := s.service.IssueStreamTicket(r.Context(), videoID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ticket)
}

func (s *Server) handleVideoStream(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	if err := s.service.ValidateStreamTicket(videoID, ticket); err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// Allow browser media element / ArtPlayer to read Range responses cross-origin.
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Add("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type")

	rangeHeader := r.Header.Get("Range")
	upstream, err := s.service.OpenJellyfinVideoStream(r.Context(), videoID, r.Method, rangeHeader)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	defer upstream.Body.Close()

	copyStreamResponseHeaders(w, upstream.Header)
	w.Header().Set("Cache-Control", "private, no-store")
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}

	w.WriteHeader(upstream.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	if _, err := io.Copy(w, upstream.Body); err != nil {
		// Client gone or upstream cut; avoid double-writing error after headers.
		log.Printf("stream proxy copy failed videoID=%s err=%v", videoID, err)
	}
}

func copyStreamResponseHeaders(w http.ResponseWriter, src http.Header) {
	if src == nil {
		return
	}
	// Hop-by-hop and auth must not leak to the browser.
	skip := map[string]struct{}{
		"Connection":           {},
		"Keep-Alive":           {},
		"Proxy-Authenticate":   {},
		"Proxy-Authorization":  {},
		"Te":                   {},
		"Trailers":             {},
		"Transfer-Encoding":    {},
		"Upgrade":              {},
		"Set-Cookie":           {},
		"Authorization":        {},
		"X-Emby-Token":         {},
		"X-Mediabrowser-Token": {},
	}
	for key, values := range src {
		ck := http.CanonicalHeaderKey(key)
		if _, ok := skip[ck]; ok {
			continue
		}
		for _, v := range values {
			w.Header().Add(ck, v)
		}
	}
}
