package api

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWithErrorLoggingLogsFailedRequests(t *testing.T) {
	var output bytes.Buffer
	prevWriter := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevWriter)
		log.SetFlags(prevFlags)
	}()

	handler := withErrorLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusBadRequest, "bad request")
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/test", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", recorder.Code)
	}

	logLine := output.String()
	if !strings.Contains(logLine, "method=POST") {
		t.Fatalf("expected method in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "path=/api/test") {
		t.Fatalf("expected path in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "status=400") {
		t.Fatalf("expected status in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "bad request") {
		t.Fatalf("expected error message in log, got %q", logLine)
	}
}

func TestWithErrorLoggingSkipsSuccessResponses(t *testing.T) {
	var output bytes.Buffer
	prevWriter := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevWriter)
		log.SetFlags(prevFlags)
	}()

	handler := withErrorLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}
	if strings.TrimSpace(output.String()) != "" {
		t.Fatalf("expected no error logs for success response, got %q", output.String())
	}
}
