package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"strings"

	"subtitle-ui/backend/internal/app"
)

func (s *Server) handleStreamTicket(w http.ResponseWriter, r *http.Request, videoID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ticket, err := s.service.IssueStreamTicket(videoID)
	if err != nil {
		s.writeAppError(w, err)
		return
	}
	// Prefer absolute-ish path; FE builds API base. Keep relative URL from service.
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

	format := r.URL.Query().Get("format")
	src, err := s.service.ResolveVideoStreamSource(videoID, format)
	if err != nil {
		s.writeAppError(w, err)
		return
	}

	// Allow browser media element / ArtPlayer to read Range responses cross-origin.
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Add("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type")

	if src.Remux {
		s.streamRemux(w, r, src)
		return
	}
	s.streamDirect(w, r, src)
}

func (s *Server) streamDirect(w http.ResponseWriter, r *http.Request, src app.VideoStreamSource) {
	file, err := os.Open(src.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, "video file not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to open video")
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stat video")
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusNotFound, "video file not found")
		return
	}

	if src.ContentType != "" {
		w.Header().Set("Content-Type", src.ContentType)
	}
	w.Header().Set("Cache-Control", "private, no-store")
	// ServeContent handles Range / HEAD / If-Modified-Since.
	http.ServeContent(w, r, path.Base(src.FileName), info.ModTime(), file)
}

func (s *Server) streamRemux(w http.ResponseWriter, r *http.Request, src app.VideoStreamSource) {
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Cache-Control", "private, no-store")
		// Progressive remux stream has no known length / no Range.
		w.Header().Set("Accept-Ranges", "none")
		w.WriteHeader(http.StatusOK)
		return
	}

	if !s.service.TryAcquireRemuxSlot() {
		writeError(w, http.StatusServiceUnavailable, app.ErrRemuxBusy.Error())
		return
	}
	defer s.service.ReleaseRemuxSlot()

	cmd := s.service.FFmpegRemuxCommand(src.Path)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start remux")
		return
	}
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "ffmpeg remux failed to start")
		return
	}

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-r.Context().Done():
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
		case <-done:
		}
	}()

	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Accept-Ranges", "none")
	w.WriteHeader(http.StatusOK)

	_, _ = io.Copy(flushingWriter{w: w}, stdout)
}

// flushingWriter flushes after each write so progressive fMP4 reaches the browser promptly.
type flushingWriter struct {
	w http.ResponseWriter
}

func (fw flushingWriter) Write(p []byte) (int, error) {
	n, err := fw.w.Write(p)
	if f, ok := fw.w.(http.Flusher); ok {
		f.Flush()
	}
	return n, err
}
