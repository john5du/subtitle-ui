package api

import (
	"io"
	"log"
	"net/http"
	"strings"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

var streamResponseHopHeaders = map[string]struct{}{
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
	claims, err := s.service.ValidateStreamTicket(videoID, ticket)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if claims.Mode != jellyfin.PlaybackModeProgressive {
		writeError(w, http.StatusBadRequest, "ticket is not a progressive stream")
		return
	}

	// Allow browser media element / ArtPlayer to read Range responses cross-origin.
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Add("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type")

	rangeHeader := r.Header.Get("Range")
	upstream, err := s.service.OpenJellyfinUpstream(r.Context(), claims.UpstreamPath, r.Method, rangeHeader)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	defer upstream.Body.Close()
	proxyStreamResponse(w, r, upstream, videoID, claims.ItemID)
}

func (s *Server) handleVideoHLSMaster(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	claims, err := s.service.ValidateStreamTicket(videoID, ticket)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if claims.Mode != jellyfin.PlaybackModeHLS {
		writeError(w, http.StatusBadRequest, "ticket is not an hls stream")
		return
	}

	upstream, err := s.service.OpenJellyfinUpstream(r.Context(), claims.UpstreamPath, http.MethodGet, "")
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	defer upstream.Body.Close()

	body, err := io.ReadAll(io.LimitReader(upstream.Body, 4<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to read hls playlist")
		return
	}
	if upstream.StatusCode < 200 || upstream.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, "jellyfin hls master failed")
		return
	}
	rewritten := s.service.RewriteHLSPlaylist(string(body), videoID, ticket, claims.UpstreamPath)
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.WriteString(w, rewritten)
}

func (s *Server) handleVideoHLSSegment(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	claims, err := s.service.ValidateStreamTicket(videoID, ticket)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	if claims.Mode != jellyfin.PlaybackModeHLS {
		writeError(w, http.StatusBadRequest, "ticket is not an hls stream")
		return
	}
	up := strings.TrimSpace(r.URL.Query().Get("u"))
	if err := jellyfin.ValidateHLSSegmentPath(up, claims.ItemID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid segment path")
		return
	}

	// Nested playlists (media m3u8) also need rewrite; binary segments pass through.
	isPlaylist := jellyfin.IsM3U8Path(up)
	method := r.Method
	if isPlaylist {
		method = http.MethodGet
	}
	rangeHeader := ""
	if !isPlaylist {
		rangeHeader = r.Header.Get("Range")
	}
	upstream, err := s.service.OpenJellyfinUpstream(r.Context(), up, method, rangeHeader)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	defer upstream.Body.Close()

	if isPlaylist {
		body, err := io.ReadAll(io.LimitReader(upstream.Body, 4<<20))
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to read hls playlist")
			return
		}
		if upstream.StatusCode < 200 || upstream.StatusCode >= 300 {
			writeError(w, http.StatusBadGateway, "jellyfin hls playlist failed")
			return
		}
		rewritten := s.service.RewriteHLSPlaylist(string(body), videoID, ticket, up)
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		_, _ = io.WriteString(w, rewritten)
		return
	}

	proxyStreamResponse(w, r, upstream, videoID, claims.ItemID)
}

func proxyStreamResponse(w http.ResponseWriter, r *http.Request, upstream *jellyfin.StreamResponse, videoID, itemID string) {
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
		log.Printf("stream proxy copy failed videoID=%s itemID=%s err=%v", videoID, itemID, err)
	}
}

func copyStreamResponseHeaders(w http.ResponseWriter, src http.Header) {
	if src == nil {
		return
	}
	for key, values := range src {
		ck := http.CanonicalHeaderKey(key)
		if _, ok := streamResponseHopHeaders[ck]; ok {
			continue
		}
		for _, v := range values {
			w.Header().Add(ck, v)
		}
	}
}
