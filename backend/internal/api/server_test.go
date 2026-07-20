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
	"subtitle-ui/backend/internal/domain"
)

func TestWithRequestLoggingLogsFailedRequests(t *testing.T) {
	var output bytes.Buffer
	prevWriter := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevWriter)
		log.SetFlags(prevFlags)
	}()

	handler := withRequestLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusBadRequest, "bad request")
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/test", nil)
	req.RemoteAddr = "127.0.0.1:54321"
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
	if !strings.Contains(logLine, "duration_ms=") {
		t.Fatalf("expected duration_ms in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "remote=127.0.0.1") {
		t.Fatalf("expected remote in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "bad request") {
		t.Fatalf("expected error message in log, got %q", logLine)
	}
}

func TestWithRequestLoggingLogsSuccessResponses(t *testing.T) {
	var output bytes.Buffer
	prevWriter := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevWriter)
		log.SetFlags(prevFlags)
	}()

	handler := withRequestLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/videos", nil)
	req.RemoteAddr = "10.0.0.2:1234"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}
	logLine := output.String()
	if !strings.Contains(logLine, "method=GET") {
		t.Fatalf("expected method in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "path=/api/videos") {
		t.Fatalf("expected path in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "status=200") {
		t.Fatalf("expected status in log, got %q", logLine)
	}
	if !strings.Contains(logLine, "remote=10.0.0.2") {
		t.Fatalf("expected remote in log, got %q", logLine)
	}
	if strings.Contains(logLine, "error=") {
		t.Fatalf("expected no error field for success response, got %q", logLine)
	}
}

func TestWithRequestLoggingSkipsHealthAndNonAPI(t *testing.T) {
	var output bytes.Buffer
	prevWriter := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevWriter)
		log.SetFlags(prevFlags)
	}()

	handler := withRequestLogging(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))

	for _, path := range []string{"/api/health", "/index.html", "/"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
	}

	if strings.TrimSpace(output.String()) != "" {
		t.Fatalf("expected no access logs for health/static paths, got %q", output.String())
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

func TestHandleLogsPagesAndClears(t *testing.T) {
	fixture := newPosterTestFixture(t)
	defer fixture.cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/logs?page=1&pageSize=1", nil)
	recorder := httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected logs status 200, got %d", recorder.Code)
	}

	var page struct {
		Items []struct {
			ID     string `json:"id"`
			Action string `json:"action"`
		} `json:"items"`
		Total      int `json:"total"`
		Page       int `json:"page"`
		PageSize   int `json:"pageSize"`
		TotalPages int `json:"totalPages"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode logs page: %v", err)
	}
	if page.Total < 1 {
		t.Fatalf("expected at least one operation log, got total=%d", page.Total)
	}
	if page.Page != 1 || page.PageSize != 1 {
		t.Fatalf("unexpected pagination metadata: page=%d pageSize=%d", page.Page, page.PageSize)
	}
	if len(page.Items) != 1 {
		t.Fatalf("expected one log item on page, got %d", len(page.Items))
	}
	if page.TotalPages < 1 {
		t.Fatalf("expected totalPages >= 1, got %d", page.TotalPages)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/logs", nil)
	recorder = httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected delete logs status 204, got %d", recorder.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/logs?page=1&pageSize=1", nil)
	recorder = httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected logs status 200 after clear, got %d", recorder.Code)
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode logs page after clear: %v", err)
	}
	// Clear leaves a single audit row so the wipe itself is visible.
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("expected clear_logs audit row after clear, total=%d len=%d", page.Total, len(page.Items))
	}
	if page.Items[0].Action != "clear_logs" {
		t.Fatalf("expected clear_logs action after clear, got %q", page.Items[0].Action)
	}
}

func TestHandleOffsetSubtitleTiming(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write movie: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte("<movie><title>Movie A</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	subtitlePath := filepath.Join(movieDir, "movie-a.zh.srt")
	if err := os.WriteFile(subtitlePath, []byte("1\n00:00:01,000 --> 00:00:02,000\nhello\n"), 0o644); err != nil {
		t.Fatalf("write subtitle: %v", err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = service.Close()
	}()
	if status := service.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("run scan: %s", status.Error)
	}
	page := service.ListVideosPage("", "movie", "", 1, 20, "", "")
	if len(page.Items) != 1 || len(page.Items[0].Subtitles) != 1 {
		t.Fatalf("expected scanned video with subtitle, got %+v", page)
	}

	server := NewServer(service, "")
	body := bytes.NewBufferString(`{"offsetMs":1200}`)
	req := httptest.NewRequest(http.MethodPost, "/api/videos/"+page.Items[0].ID+"/subtitles/"+page.Items[0].Subtitles[0].ID+"/timing/offset", body)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected offset status 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode offset response: %v", err)
	}
	if response.ID != page.Items[0].Subtitles[0].ID {
		t.Fatalf("expected response subtitle id %s, got %s", page.Items[0].Subtitles[0].ID, response.ID)
	}
	shifted, err := os.ReadFile(subtitlePath)
	if err != nil {
		t.Fatalf("read shifted subtitle: %v", err)
	}
	if !strings.Contains(string(shifted), "00:00:02,200 --> 00:00:03,200") {
		t.Fatalf("expected shifted subtitle file, got %q", string(shifted))
	}
	logEntry, ok := latestAPILogByAction(service.ListLogs(20), "offset")
	if !ok || !strings.Contains(logEntry.Message, "offset_ms=1200") {
		t.Fatalf("expected offset log with message, got ok=%v log=%+v", ok, logEntry)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/videos/"+page.Items[0].ID+"/subtitles/"+page.Items[0].Subtitles[0].ID+"/timing/offset", bytes.NewBufferString(`{"offsetMs":0}`))
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid offset status 400, got %d", recorder.Code)
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

func latestAPILogByAction(logs []domain.OperationLog, action string) (domain.OperationLog, bool) {
	for _, item := range logs {
		if item.Action == action {
			return item, true
		}
	}
	return domain.OperationLog{}, false
}

func TestAdminAuthDisabledWhenTokenEmpty(t *testing.T) {
	fixture := newPosterTestFixture(t)
	defer fixture.cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	recorder := httptest.NewRecorder()
	fixture.server.Handler().ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200 when auth disabled, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestAdminAuthProtectsAPI(t *testing.T) {
	fixture := newPosterTestFixture(t)
	defer fixture.cleanup()

	service := fixture.server.service
	server := NewServerWithConfig(service, config.Config{
		AdminToken:         "secret-token",
		CORSAllowedOrigins: []string{"http://localhost:3300"},
	})
	handler := server.Handler()

	t.Run("missing token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("wrong token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
		req.Header.Set("Authorization", "Bearer wrong")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("valid bearer", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
		req.Header.Set("Authorization", "Bearer secret-token")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("health remains public", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected health 200, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("poster remains public", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/videos/"+fixture.movieID+"/poster", nil)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected poster 200, got %d body=%s", recorder.Code, recorder.Body.String())
		}
		if body := recorder.Body.Bytes(); string(body) != "movie-poster" {
			t.Fatalf("unexpected poster body: %q", string(body))
		}
	})

	t.Run("options preflight allows authorization header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/api/version", nil)
		req.Header.Set("Origin", "http://localhost:3300")
		req.Header.Set("Access-Control-Request-Method", "GET")
		req.Header.Set("Access-Control-Request-Headers", "authorization")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("expected 204 preflight, got %d body=%s", recorder.Code, recorder.Body.String())
		}
		allowHeaders := recorder.Header().Get("Access-Control-Allow-Headers")
		if !strings.Contains(strings.ToLower(allowHeaders), "authorization") {
			t.Fatalf("expected Authorization in Allow-Headers, got %q", allowHeaders)
		}
	})
}

func TestVideoStreamTicketAndRange(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte("0123456789abcdefghij")
	if err := os.WriteFile(filepath.Join(movieDir, "clip.mp4"), payload, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "clip.nfo"), []byte("<movie><title>Clip</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatal(err)
	}

	service, err := app.NewService(config.Config{
		MovieMediaRoot:     movieRoot,
		TVMediaRoot:        tvRoot,
		DBPath:             filepath.Join(base, "test.sqlite3"),
		AdminToken:         "stream-test-token",
		StreamTicketSecret: "stream-secret",
		StreamRemux:        "off",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = service.Close() }()
	if status := service.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := service.ListVideosPage("", "movie", "", 1, 10, "", "")
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	videoID := page.Items[0].ID
	server := NewServerWithConfig(service, config.Config{
		AdminToken:         "stream-test-token",
		CORSAllowedOrigins: []string{"http://localhost:3300"},
	})
	handler := server.Handler()

	// Ticket requires auth
	unauthTicket := httptest.NewRequest(http.MethodPost, "/api/videos/"+videoID+"/stream-ticket", nil)
	unauthRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthRec, unauthTicket)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for ticket without auth, got %d", unauthRec.Code)
	}

	ticketReq := httptest.NewRequest(http.MethodPost, "/api/videos/"+videoID+"/stream-ticket", nil)
	ticketReq.Header.Set("Authorization", "Bearer stream-test-token")
	ticketRec := httptest.NewRecorder()
	handler.ServeHTTP(ticketRec, ticketReq)
	if ticketRec.Code != http.StatusOK {
		t.Fatalf("ticket status %d body=%s", ticketRec.Code, ticketRec.Body.String())
	}
	var ticketBody struct {
		Ticket string `json:"ticket"`
		URL    string `json:"url"`
	}
	if err := json.Unmarshal(ticketRec.Body.Bytes(), &ticketBody); err != nil {
		t.Fatalf("decode ticket: %v", err)
	}
	if ticketBody.Ticket == "" {
		t.Fatal("empty ticket")
	}

	// Stream without ticket
	noTicket := httptest.NewRequest(http.MethodGet, "/api/videos/"+videoID+"/stream", nil)
	noTicketRec := httptest.NewRecorder()
	handler.ServeHTTP(noTicketRec, noTicket)
	if noTicketRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without ticket, got %d", noTicketRec.Code)
	}

	// Full stream with ticket
	fullReq := httptest.NewRequest(http.MethodGet, "/api/videos/"+videoID+"/stream?ticket="+ticketBody.Ticket+"&format=direct", nil)
	fullRec := httptest.NewRecorder()
	handler.ServeHTTP(fullRec, fullReq)
	if fullRec.Code != http.StatusOK {
		t.Fatalf("stream status %d body=%s", fullRec.Code, fullRec.Body.String())
	}
	if !bytes.Equal(fullRec.Body.Bytes(), payload) {
		t.Fatalf("unexpected body %q", fullRec.Body.String())
	}
	if ct := fullRec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "video/") {
		t.Fatalf("content-type %q", ct)
	}

	// Range request
	rangeReq := httptest.NewRequest(http.MethodGet, "/api/videos/"+videoID+"/stream?ticket="+ticketBody.Ticket+"&format=direct", nil)
	rangeReq.Header.Set("Range", "bytes=0-3")
	rangeRec := httptest.NewRecorder()
	handler.ServeHTTP(rangeRec, rangeReq)
	if rangeRec.Code != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d body=%s", rangeRec.Code, rangeRec.Body.String())
	}
	if got := rangeRec.Body.Bytes(); !bytes.Equal(got, payload[:4]) {
		t.Fatalf("range body %q", string(got))
	}
	if cr := rangeRec.Header().Get("Content-Range"); !strings.HasPrefix(cr, "bytes 0-3/") {
		t.Fatalf("content-range %q", cr)
	}
}
