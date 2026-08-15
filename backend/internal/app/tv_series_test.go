package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func TestTVSeriesSummariesUseSeriesNFOForSearchAndExternalIDs(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}

	episodeDir := filepath.Join(tvRoot, "Daredevil - Born Again", "Season 1")
	if err := os.MkdirAll(episodeDir, 0o755); err != nil {
		t.Fatalf("mkdir episode dir: %v", err)
	}
	episodePath := filepath.Join(episodeDir, "Afterlight Station S01E01.mkv")
	if err := os.WriteFile(episodePath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write episode: %v", err)
	}
	episodeNFO := `<episodedetails><title>Platform Zero</title><originaltitle>Platform Zero Original</originaltitle><year>2025</year></episodedetails>`
	if err := os.WriteFile(filepath.Join(episodeDir, "Afterlight Station S01E01.nfo"), []byte(episodeNFO), 0o644); err != nil {
		t.Fatalf("write episode nfo: %v", err)
	}
	seriesNFO := `<tvshow><title>夜魔侠：重生</title><originaltitle>Daredevil: Born Again</originaltitle><year>2025</year><imdb_id>tt18923754</imdb_id><tmdbid>202555</tmdbid></tvshow>`
	if err := os.WriteFile(filepath.Join(tvRoot, "Daredevil - Born Again", "tvshow.nfo"), []byte(seriesNFO), 0o644); err != nil {
		t.Fatalf("write series nfo: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	status := svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("scan status error: %s", status.Error)
	}

	tvVideos := mustListVideosPage(t, svc, domain.MediaTypeTV, 20)
	if len(tvVideos.Items) != 1 {
		t.Fatalf("expected 1 tv episode, got %d", len(tvVideos.Items))
	}
	if tvVideos.Items[0].Title != "Platform Zero" {
		t.Fatalf("expected episode title, got %q", tvVideos.Items[0].Title)
	}
	if tvVideos.Items[0].SeriesTitle != "夜魔侠：重生" || tvVideos.Items[0].SeriesOriginalTitle != "Daredevil: Born Again" {
		t.Fatalf("unexpected stored series titles: %+v", tvVideos.Items[0])
	}
	if tvVideos.Items[0].SeriesImdbID != "tt18923754" || tvVideos.Items[0].SeriesTmdbID != "202555" {
		t.Fatalf("unexpected stored series ids: %+v", tvVideos.Items[0])
	}

	chinese, err := svc.ListTVSeriesPage("夜魔侠", 1, 20, "", "")
	if err != nil {
		t.Fatalf("list chinese series: %v", err)
	}
	if chinese.Total != 1 || len(chinese.Items) != 1 {
		t.Fatalf("expected Chinese query to find series, total=%d items=%+v", chinese.Total, chinese.Items)
	}
	english, err := svc.ListTVSeriesPage("Daredevil", 1, 20, "", "")
	if err != nil {
		t.Fatalf("list english series: %v", err)
	}
	if english.Total != 1 || len(english.Items) != 1 {
		t.Fatalf("expected English query to find series, total=%d items=%+v", english.Total, english.Items)
	}

	row := chinese.Items[0]
	if row.Title != "夜魔侠：重生" || row.OriginalTitle != "Daredevil: Born Again" {
		t.Fatalf("unexpected series summary titles: %+v", row)
	}
	if row.ImdbID != "tt18923754" || row.TmdbID != "202555" {
		t.Fatalf("unexpected series summary ids: %+v", row)
	}
}

func TestSortTVSeriesSummaries(t *testing.T) {
	base := []domain.TVSeriesSummary{
		{Title: "Charlie", Path: "/tv/c", LatestEpisodeYear: "2020", UpdatedAt: "2024-01-03T00:00:00Z", VideoCount: 2, NoSubtitleCount: 1},
		{Title: "Alpha", Path: "/tv/a", LatestEpisodeYear: "2022", UpdatedAt: "2024-01-01T00:00:00Z", VideoCount: 5, NoSubtitleCount: 0},
		{Title: "Bravo", Path: "/tv/b", LatestEpisodeYear: "2021", UpdatedAt: "2024-01-02T00:00:00Z", VideoCount: 3, NoSubtitleCount: 2},
	}

	assertTitles := func(t *testing.T, items []domain.TVSeriesSummary, want []string) {
		t.Helper()
		got := make([]string, 0, len(items))
		for _, item := range items {
			got = append(got, item.Title)
		}
		if len(got) != len(want) {
			t.Fatalf("got %v want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("got %v want %v", got, want)
			}
		}
	}

	clone := func() []domain.TVSeriesSummary {
		out := make([]domain.TVSeriesSummary, len(base))
		copy(out, base)
		return out
	}

	items := clone()
	sortTVSeriesSummaries(items, "title", "asc")
	assertTitles(t, items, []string{"Alpha", "Bravo", "Charlie"})

	items = clone()
	sortTVSeriesSummaries(items, "year", "desc")
	assertTitles(t, items, []string{"Alpha", "Bravo", "Charlie"})

	items = clone()
	sortTVSeriesSummaries(items, "updatedAt", "desc")
	assertTitles(t, items, []string{"Charlie", "Bravo", "Alpha"})

	items = clone()
	sortTVSeriesSummaries(items, "videoCount", "desc")
	assertTitles(t, items, []string{"Alpha", "Bravo", "Charlie"})

	items = clone()
	sortTVSeriesSummaries(items, "noSubtitleCount", "desc")
	assertTitles(t, items, []string{"Bravo", "Charlie", "Alpha"})
}
