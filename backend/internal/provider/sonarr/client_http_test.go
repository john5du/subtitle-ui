package sonarr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"subtitle-ui/backend/internal/provider/sonarr"
)

func TestClientListAndSearch(t *testing.T) {
	var gotCommand map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "test-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/system/status":
			_ = json.NewEncoder(w).Encode(map[string]any{"version": "4.0.0", "appName": "Sonarr"})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/series":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": 10, "title": "Show", "path": "/tv/Show", "tmdbId": 99, "imdbId": "tt1", "status": "continuing"},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v3/episode":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": 101, "seriesId": 10, "seasonNumber": 1, "episodeNumber": 1, "title": "Pilot", "airDate": "2020-01-01", "monitored": true},
				{"id": 102, "seriesId": 10, "seasonNumber": 1, "episodeNumber": 2, "title": "Next", "airDate": "2099-01-01", "monitored": true},
				{"id": 103, "seriesId": 10, "seasonNumber": 1, "episodeNumber": 3, "title": "Off", "airDate": "2020-01-03", "monitored": false},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v3/command":
			_ = json.NewDecoder(r.Body).Decode(&gotCommand)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": 7, "name": "EpisodeSearch", "status": "queued"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	c := sonarr.New(sonarr.Options{Enabled: true, BaseURL: srv.URL, APIKey: "test-key"})
	series, err := c.ListSeries(context.Background())
	if err != nil || len(series) != 1 || series[0].ID != 10 {
		t.Fatalf("ListSeries: %+v err=%v", series, err)
	}
	eps, err := c.ListEpisodes(context.Background(), 10, 1)
	if err != nil || len(eps) != 3 {
		t.Fatalf("ListEpisodes: %+v err=%v", eps, err)
	}
	cmd, err := c.EpisodeSearch(context.Background(), []int{101})
	if err != nil || cmd.ID != 7 {
		t.Fatalf("EpisodeSearch: %+v err=%v", cmd, err)
	}
	if gotCommand["name"] != "EpisodeSearch" {
		t.Fatalf("command name: %#v", gotCommand)
	}
	if err := c.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
