package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
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

func TestListResponsesIncludePosterURLs(t *testing.T) {
	fixture := newPosterTestFixture(t)
	defer fixture.cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/videos?mediaType=movie&page=1&pageSize=20", nil)
	recorder := httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected movie list status 200, got %d", recorder.Code)
	}

	var moviePage struct {
		Items []struct {
			ID        string `json:"id"`
			PosterURL string `json:"posterUrl"`
		} `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &moviePage); err != nil {
		t.Fatalf("decode movie page: %v", err)
	}

	moviePosterURL := ""
	missingPosterURL := ""
	for _, item := range moviePage.Items {
		switch item.ID {
		case fixture.movieID:
			moviePosterURL = item.PosterURL
		case fixture.missingMovieID:
			missingPosterURL = item.PosterURL
		}
	}
	expectedMoviePosterURL := "http://example.com/api/videos/" + fixture.movieID + "/poster"
	if moviePosterURL != expectedMoviePosterURL {
		t.Fatalf("expected movie poster url %q, got %q", expectedMoviePosterURL, moviePosterURL)
	}
	if missingPosterURL != "" {
		t.Fatalf("expected missing movie poster url to be empty, got %q", missingPosterURL)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/tv/series?page=1&pageSize=20", nil)
	recorder = httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected tv list status 200, got %d", recorder.Code)
	}

	var tvPage struct {
		Items []struct {
			PosterURL string `json:"posterUrl"`
		} `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &tvPage); err != nil {
		t.Fatalf("decode tv page: %v", err)
	}
	if len(tvPage.Items) != 1 {
		t.Fatalf("expected 1 tv series row, got %d", len(tvPage.Items))
	}
	expectedTVPosterURL := "http://example.com/api/videos/" + fixture.tvID + "/poster"
	if tvPage.Items[0].PosterURL != expectedTVPosterURL {
		t.Fatalf("expected tv poster url %q, got %q", expectedTVPosterURL, tvPage.Items[0].PosterURL)
	}
}

func TestHandleVideoPoster(t *testing.T) {
	fixture := newPosterTestFixture(t)
	defer fixture.cleanup()

	cases := []struct {
		name       string
		videoID    string
		wantStatus int
		wantBody   []byte
	}{
		{
			name:       "movie poster",
			videoID:    fixture.movieID,
			wantStatus: http.StatusOK,
			wantBody:   []byte("movie-poster"),
		},
		{
			name:       "tv poster",
			videoID:    fixture.tvID,
			wantStatus: http.StatusOK,
			wantBody:   []byte("tv-poster"),
		},
		{
			name:       "missing poster",
			videoID:    fixture.missingMovieID,
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "unknown video",
			videoID:    "missing-video",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/videos/"+tc.videoID+"/poster", nil)
			recorder := httptest.NewRecorder()
			fixture.server.Handler().ServeHTTP(recorder, req)

			if recorder.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d", tc.wantStatus, recorder.Code)
			}

			if tc.wantStatus == http.StatusOK {
				if got := recorder.Body.Bytes(); !bytes.Equal(got, tc.wantBody) {
					t.Fatalf("unexpected poster body: %q", string(got))
				}
				if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "image/") {
					t.Fatalf("expected image content type, got %q", contentType)
				}
				if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != "public, max-age=0, must-revalidate" {
					t.Fatalf("expected cache-control header, got %q", cacheControl)
				}
				if etag := recorder.Header().Get("ETag"); etag == "" {
					t.Fatalf("expected etag header")
				}
				if lastModified := recorder.Header().Get("Last-Modified"); lastModified == "" {
					t.Fatalf("expected last-modified header")
				}
			}
		})
	}
}

func TestHandleVideoPosterHonorsIfNoneMatch(t *testing.T) {
	fixture := newPosterTestFixture(t)
	defer fixture.cleanup()

	firstReq := httptest.NewRequest(http.MethodGet, "/api/videos/"+fixture.movieID+"/poster", nil)
	firstRecorder := httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(firstRecorder, firstReq)

	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("expected initial status 200, got %d", firstRecorder.Code)
	}

	etag := firstRecorder.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("expected etag header on initial response")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/videos/"+fixture.movieID+"/poster", nil)
	req.Header.Set("If-None-Match", etag)
	recorder := httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNotModified {
		t.Fatalf("expected status 304, got %d", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("expected empty 304 body, got %q", recorder.Body.String())
	}
}

type posterTestFixture struct {
	server         *Server
	cleanup        func()
	movieID        string
	missingMovieID string
	tvID           string
}

func newPosterTestFixture(t *testing.T) posterTestFixture {
	t.Helper()

	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")

	for _, dir := range []string{movieRoot, tvRoot} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	movieDir := filepath.Join(movieRoot, "Movie A")
	missingMovieDir := filepath.Join(movieRoot, "Movie Missing")
	for _, dir := range []string{movieDir, missingMovieDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte("<movie><title>Movie A</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatalf("write movie nfo: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie.png"), []byte("movie-poster"), 0o644); err != nil {
		t.Fatalf("write movie poster: %v", err)
	}

	if err := os.WriteFile(filepath.Join(missingMovieDir, "movie-missing.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write missing movie file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(missingMovieDir, "movie-missing.nfo"), []byte("<movie><title>Movie Missing</title><year>2024</year></movie>"), 0o644); err != nil {
		t.Fatalf("write missing movie nfo: %v", err)
	}

	tvEpisodePath := filepath.Join(tvRoot, "Series A", "Season 1", "series-a-s01e01.mkv")
	if err := os.MkdirAll(filepath.Dir(tvEpisodePath), 0o755); err != nil {
		t.Fatalf("mkdir tv series dir: %v", err)
	}
	if err := os.WriteFile(tvEpisodePath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write tv episode: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(tvEpisodePath), "series-a-s01e01.nfo"), []byte("<movie><title>Series A</title><year>2024</year></movie>"), 0o644); err != nil {
		t.Fatalf("write tv nfo: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tvRoot, "Series A", "folder.jpg"), []byte("tv-poster"), 0o644); err != nil {
		t.Fatalf("write tv poster: %v", err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	if status := service.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("run scan: %s", status.Error)
	}

	cleanup := func() {
		_ = service.Close()
	}

	moviePage := service.ListVideosPage("", "movie", "", 1, 20, "", "")
	tvPage := service.ListVideosPage("", "tv", "", 1, 20, "", "")

	fixture := posterTestFixture{
		server:  NewServer(service, ""),
		cleanup: cleanup,
	}
	for _, item := range moviePage.Items {
		switch item.Title {
		case "Movie A":
			fixture.movieID = item.ID
		case "Movie Missing":
			fixture.missingMovieID = item.ID
		}
	}
	if len(tvPage.Items) > 0 {
		fixture.tvID = tvPage.Items[0].ID
	}
	if fixture.movieID == "" || fixture.missingMovieID == "" || fixture.tvID == "" {
		cleanup()
		t.Fatalf("expected scanned ids for movie=%q missing=%q tv=%q", fixture.movieID, fixture.missingMovieID, fixture.tvID)
	}

	return fixture
}
