package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
)

func TestAttachJellyfinPlaybackDisabledOmitsField(t *testing.T) {
	svc, videoID := setupEmbeddedSubtitleFixture(t, nil)
	defer func() { _ = svc.Close() }()

	video := mustGetVideo(t, svc, videoID)
	items := []domain.Video{video}
	svc.AttachJellyfinPlayback(context.Background(), items)
	if items[0].Playback != nil {
		t.Fatalf("expected no playback when jellyfin off: %+v", items[0].Playback)
	}
}

func TestAttachJellyfinPlaybackMatchesLocalAndMappedPath(t *testing.T) {
	var videoPath string
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Users":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/Users/") && strings.HasSuffix(r.URL.Path, "/Items"):
			mapped := "/data/movies/Movie/movie.mp4"
			filter := r.URL.Query().Get("Filters")
			items := []map[string]any{}
			if filter == "IsPlayed" {
				items = append(items, map[string]any{"Path": mapped, "UserData": map[string]any{"Played": true}})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Items": items})
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
		cfg.JellyfinPathMap = filepath.ToSlash(filepath.Dir(path)) + ":/data/movies/Movie"
	})
	defer func() { _ = svc.Close() }()

	video := mustGetVideo(t, svc, videoID)
	if video.Path != videoPath {
		t.Fatalf("path=%s want %s", video.Path, videoPath)
	}
	items := []domain.Video{video}
	svc.AttachJellyfinPlayback(context.Background(), items)
	if items[0].Playback == nil || !items[0].Playback.Played || items[0].Playback.InProgress {
		t.Fatalf("playback=%+v", items[0].Playback)
	}
}

func TestAttachJellyfinPlaybackInProgress(t *testing.T) {
	var videoPath string
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/Users":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"Id": "user-1", "Policy": map[string]any{"IsAdministrator": true, "IsDisabled": false}},
			})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/Users/") && strings.HasSuffix(r.URL.Path, "/Items"):
			items := []map[string]any{}
			if r.URL.Query().Get("Filters") == "IsResumable" && videoPath != "" {
				items = append(items, map[string]any{
					"Path":     videoPath,
					"UserData": map[string]any{"PlaybackPositionTicks": 42},
				})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Items": items})
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

	video := mustGetVideo(t, svc, videoID)
	items := []domain.Video{video}
	svc.AttachJellyfinPlayback(context.Background(), items)
	if items[0].Playback == nil || items[0].Playback.Played || !items[0].Playback.InProgress {
		t.Fatalf("playback=%+v", items[0].Playback)
	}
}

func TestAttachJellyfinPlaybackTimeoutDoesNotFail(t *testing.T) {
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		http.NotFound(w, r)
	}))
	t.Cleanup(jf.Close)

	svc, videoID := setupEmbeddedSubtitleFixture(t, func(cfg *config.Config, _ string) {
		cfg.JellyfinEnabled = true
		cfg.JellyfinURL = jf.URL
		cfg.JellyfinAPIKey = "jf-key"
	})
	defer func() { _ = svc.Close() }()

	video := mustGetVideo(t, svc, videoID)
	items := []domain.Video{video}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	svc.AttachJellyfinPlayback(ctx, items)
	if items[0].Playback != nil {
		t.Fatalf("timeout should omit playback: %+v", items[0].Playback)
	}
}
