package api

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

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
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusOK)
		return
	}

	if !s.service.TryAcquireRemuxSlot() {
		writeError(w, http.StatusServiceUnavailable, app.ErrRemuxBusy.Error())
		return
	}
	defer s.service.ReleaseRemuxSlot()

	// Prefer temp-file remux (+faststart) so HTML5 video gets Range seek and a valid moov.
	// Falls back to progressive pipe if temp remux fails (unless client already left).
	if err := s.streamRemuxTempFile(w, r, src); err != nil {
		if r.Context().Err() != nil {
			return
		}
		log.Printf("stream remux temp failed for %s: %v", src.VideoID, err)
		s.streamRemuxPipe(w, r, src)
	}
}

func (s *Server) streamRemuxTempFile(w http.ResponseWriter, r *http.Request, src app.VideoStreamSource) error {
	tmpDir := os.TempDir()
	tmp, err := os.CreateTemp(tmpDir, "subtitle-ui-remux-*.mp4")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	defer func() { _ = os.Remove(tmpPath) }()

	cmd := s.service.FFmpegRemuxToMP4Command(src.Path, tmpPath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	// Cap remux wall time so a stuck ffmpeg cannot hold the slot forever.
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()

	select {
	case <-r.Context().Done():
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
		return r.Context().Err()
	case err := <-done:
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return errors.New(msg)
		}
	case <-time.After(3 * time.Minute):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
		return errors.New("ffmpeg remux timed out")
	}

	info, err := os.Stat(tmpPath)
	if err != nil {
		return err
	}
	if info.Size() < 1024 {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = "remux output too small"
		}
		return errors.New(msg)
	}

	file, err := os.Open(tmpPath)
	if err != nil {
		return err
	}
	defer file.Close()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "private, no-store")
	// ServeContent enables Range so ArtPlayer progress scrubbing works on remuxed preview.
	http.ServeContent(w, r, filepath.Base(src.FileName)+".mp4", info.ModTime(), file)
	return nil
}

func (s *Server) streamRemuxPipe(w http.ResponseWriter, r *http.Request, src app.VideoStreamSource) {
	cmd := s.service.FFmpegRemuxCommand(src.Path)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start remux")
		return
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
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

	// Probe first chunk before committing to 200 so broken remux returns a real error.
	buf := make([]byte, 64*1024)
	n, readErr := stdout.Read(buf)
	if n == 0 {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		msg := strings.TrimSpace(stderr.String())
		if msg == "" && readErr != nil && !errors.Is(readErr, io.EOF) {
			msg = readErr.Error()
		}
		if msg == "" {
			msg = "ffmpeg remux produced no output"
		}
		writeError(w, http.StatusServiceUnavailable, "ffmpeg remux failed: "+msg)
		return
	}

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

	fw := flushingWriter{w: w}
	_, _ = fw.Write(buf[:n])
	if readErr == nil {
		_, _ = io.Copy(fw, stdout)
	}
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
