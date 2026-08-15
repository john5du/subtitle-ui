package api

import (
	"bytes"
	"log"
	"net/http"
	"strings"
	"time"
)

type errorCaptureResponseWriter struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

const maxCapturedErrorBodyBytes = 512

func (w *errorCaptureResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *errorCaptureResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	if w.status >= http.StatusBadRequest {
		if remaining := maxCapturedErrorBodyBytes - w.body.Len(); remaining > 0 {
			chunk := data
			if len(chunk) > remaining {
				chunk = chunk[:remaining]
			}
			_, _ = w.body.Write(chunk)
		}
	}
	return w.ResponseWriter.Write(data)
}

func withRequestLogging(next http.Handler, trustForwarded bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !shouldLogAPIRequest(r) {
			next.ServeHTTP(w, r)
			return
		}

		started := time.Now()
		captured := &errorCaptureResponseWriter{ResponseWriter: w}
		next.ServeHTTP(captured, r)

		status := captured.status
		if status == 0 {
			status = http.StatusOK
		}
		durationMS := time.Since(started).Milliseconds()
		remote := requestRemoteAddr(r, trustForwarded)

		if status >= http.StatusBadRequest {
			errorMessage := parseErrorMessage(captured.body.Bytes())
			log.Printf(
				"api request: method=%s path=%s status=%d duration_ms=%d remote=%s error=%q",
				r.Method,
				r.URL.Path,
				status,
				durationMS,
				remote,
				errorMessage,
			)
			return
		}

		log.Printf(
			"api request: method=%s path=%s status=%d duration_ms=%d remote=%s",
			r.Method,
			r.URL.Path,
			status,
			durationMS,
			remote,
		)
	})
}

func shouldLogAPIRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.Method == http.MethodOptions {
		return false
	}
	path := r.URL.Path
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	if r.Method == http.MethodGet && path == "/api/health" {
		return false
	}
	return true
}
