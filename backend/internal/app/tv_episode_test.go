package app

import (
	"testing"
	"time"

	"subtitle-ui/backend/internal/provider/sonarr"
)

func TestParseSeasonEpisodeNumbersForCompleteness(t *testing.T) {
	cases := []struct {
		text    string
		def     int
		season  int
		episode int
		ok      bool
	}{
		{"Show.S01E05.mkv", 0, 1, 5, true},
		{"Show 1x07", 0, 1, 7, true},
		{"Season 2 Episode 3", 0, 2, 3, true},
		{"第12集", 1, 1, 12, true},
		{"E04", 2, 2, 4, true},
		{"random", 1, 0, 0, false},
	}
	for _, tc := range cases {
		got := parseSeasonEpisodeNumbersWithDefault(tc.text, tc.def)
		if (got != nil) != tc.ok {
			t.Fatalf("%q ok=%v want %v", tc.text, got != nil, tc.ok)
		}
		if got == nil {
			continue
		}
		if got.Season != tc.season || got.Episode != tc.episode {
			t.Fatalf("%q got S%02dE%02d want S%02dE%02d", tc.text, got.Season, got.Episode, tc.season, tc.episode)
		}
	}
}

func TestEpisodeHasAired(t *testing.T) {
	now := mustParseTime(t, "2026-07-11T12:00:00Z")
	if !episodeHasAired(sonarr.Episode{AirDate: "2026-07-10"}, now) {
		t.Fatal("past air date should count as aired")
	}
	if episodeHasAired(sonarr.Episode{AirDate: "2026-07-12"}, now) {
		t.Fatal("future air date should not count as aired")
	}
	if episodeHasAired(sonarr.Episode{}, now) {
		t.Fatal("empty air date should not count as aired")
	}
	if !episodeHasAired(sonarr.Episode{AirDateUTC: "2026-07-01T00:00:00Z"}, now) {
		t.Fatal("past utc air date should count as aired")
	}
}

func mustParseTime(t *testing.T, raw string) time.Time {
	t.Helper()
	tt, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatal(err)
	}
	return tt
}
