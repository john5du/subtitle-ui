package api

import (
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	appdomain "subtitle-ui/backend/internal/domain"
)

func (s *Server) attachVideoPosterURLs(r *http.Request, videos []appdomain.Video) {
	for i := range videos {
		s.attachVideoPosterURL(r, &videos[i])
	}
}

func (s *Server) attachVideoPosterURL(r *http.Request, video *appdomain.Video) {
	if video == nil || strings.TrimSpace(video.PosterPath) == "" {
		return
	}
	video.PosterURL = s.buildVideoPosterURL(r, video.ID)
}

func (s *Server) attachTVSeriesPosterURLs(r *http.Request, rows []appdomain.TVSeriesSummary) {
	for i := range rows {
		if strings.TrimSpace(rows[i].PosterVideoID) == "" {
			continue
		}
		rows[i].PosterURL = s.buildVideoPosterURL(r, rows[i].PosterVideoID)
	}
}

func (s *Server) buildVideoPosterURL(r *http.Request, videoID string) string {
	pathValue := "/api/videos/" + url.PathEscape(videoID) + "/poster"
	base := s.requestBaseURL(r)
	if base == "" {
		return pathValue
	}
	return base + pathValue
}

func (s *Server) requestBaseURL(r *http.Request) string {
	if r == nil {
		return ""
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if s.trustForwardedHeaders {
		if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
			scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
		if forwardedHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
			host = strings.TrimSpace(strings.Split(forwardedHost, ",")[0])
		}
	}
	if host == "" {
		return ""
	}

	return scheme + "://" + host
}

func makePosterETag(info os.FileInfo) string {
	if info == nil {
		return ""
	}
	return `W/"` + strconv.FormatInt(info.Size(), 10) + `-` + strconv.FormatInt(info.ModTime().UTC().UnixNano(), 10) + `"`
}

func headerMatchesETag(raw string, etag string) bool {
	if etag == "" {
		return false
	}
	for _, candidate := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "*" || trimmed == etag {
			return true
		}
	}
	return false
}
