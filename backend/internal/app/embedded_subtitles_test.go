package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/config"
)

func TestListEmbeddedSubtitlesRequiresJellyfin(t *testing.T) {
	svc, videoID := setupEmbeddedSubtitleFixture(t, nil)
	defer func() { _ = svc.Close() }()

	_, err := svc.ListEmbeddedSubtitles(context.Background(), videoID)
	if !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("expected provider disabled, got %v", err)
	}
}

func TestListEmbeddedSubtitlesListsTracks(t *testing.T) {
	var videoPath string
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Users":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Name": "admin", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/Items" && r.URL.Query().Get("StartIndex") != "":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Items": []map[string]string{
					{"Id": "item-emb", "Path": videoPath},
				},
			})
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/PlaybackInfo"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"MediaSources": []map[string]any{
					{
						"Id": "ms-emb",
						"MediaStreams": []map[string]any{
							{"Index": 0, "Type": "Video", "Codec": "h264"},
							{
								"Index": 2, "Type": "Subtitle", "Codec": "ass", "Language": "chi",
								"Title": "简体", "DisplayTitle": "Chinese", "IsExternal": false,
								"IsTextSubtitleStream": true, "IsDefault": true,
							},
							{
								"Index": 3, "Type": "Subtitle", "Codec": "subrip", "Language": "eng",
								"IsExternal": true, "IsTextSubtitleStream": true,
							},
							{
								"Index": 4, "Type": "Subtitle", "Codec": "pgssub",
								"IsExternal": false, "IsTextSubtitleStream": false,
							},
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(jf.Close)

	svc, videoID := setupEmbeddedSubtitleFixture(t, func(cfg *config.Config, path string) {
		videoPath = path
		cfg.JellyfinEnabled = true
		cfg.JellyfinURL = jf.URL
		cfg.JellyfinAPIKey = "jf-key"
	})
	defer func() { _ = svc.Close() }()

	list, err := svc.ListEmbeddedSubtitles(context.Background(), videoID)
	if err != nil {
		t.Fatalf("ListEmbeddedSubtitles: %v", err)
	}
	if len(list.Tracks) != 2 {
		t.Fatalf("tracks=%d want 2: %+v", len(list.Tracks), list.Tracks)
	}
	if list.Tracks[0].Language != "chi" || list.Tracks[0].Codec != "ass" || !list.Tracks[0].IsText || !list.Tracks[0].IsDefault {
		t.Fatalf("track0=%+v", list.Tracks[0])
	}
	if list.Tracks[1].Language != "und" || list.Tracks[1].IsText {
		t.Fatalf("track1=%+v", list.Tracks[1])
	}
}

func TestListEmbeddedSubtitlesItemNotFound(t *testing.T) {
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/Items" {
			_ = json.NewEncoder(w).Encode(map[string]any{"Items": []any{}})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(jf.Close)

	svc, videoID := setupEmbeddedSubtitleFixture(t, func(cfg *config.Config, _ string) {
		cfg.JellyfinEnabled = true
		cfg.JellyfinURL = jf.URL
		cfg.JellyfinAPIKey = "jf-key"
	})
	defer func() { _ = svc.Close() }()

	_, err := svc.ListEmbeddedSubtitles(context.Background(), videoID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

func setupEmbeddedSubtitleFixture(t *testing.T, tune func(*config.Config, string)) (*Service, string) {
	t.Helper()
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
	videoPath := filepath.Join(movieDir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie.nfo"), []byte("<movie><title>Emb</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
		AdminToken:     "test-admin-token",
	}
	if tune != nil {
		tune(&cfg, videoPath)
	}
	svc, err := NewService(cfg)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", "movie", "", 1, 10, "", "")
	if len(page.Items) != 1 {
		_ = svc.Close()
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	return svc, page.Items[0].ID
}
