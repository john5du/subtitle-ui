package store

import (
	"path/filepath"
	"testing"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/textsort"
)

func TestListTVSeriesPageSortFilterAndPagination(t *testing.T) {
	st, err := Open(TestDSN(t))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() { _ = st.Close() }()

	now := time.Now().UTC()
	tvRoot := filepath.Join(t.TempDir(), "tv")
	series := []struct {
		id, folder, title, year string
		updated                 time.Time
		subs                    int
	}{
		{id: "A1", folder: "Alpha", title: "Alpha", year: "2022", updated: now.Add(-2 * time.Hour), subs: 1},
		{id: "B1", folder: "Bravo", title: "Bravo", year: "2021", updated: now.Add(-time.Hour), subs: 0},
		{id: "C1", folder: "Charlie", title: "Charlie", year: "2020", updated: now, subs: 2},
	}
	videos := make([]domain.Video, 0, len(series))
	for _, item := range series {
		dir := filepath.Join(tvRoot, item.folder, "Season 1")
		video := domain.Video{
			ID:                 item.id,
			Path:               filepath.Join(dir, item.folder+" S01E01.mkv"),
			Directory:          dir,
			FileName:           item.folder + " S01E01.mkv",
			Title:              "E1",
			Year:               item.year,
			MediaType:          domain.MediaTypeTV,
			SeriesTitle:        item.title,
			SeriesKey:          filepath.ToSlash(filepath.Join(tvRoot, item.folder)),
			SeriesPath:         filepath.Join(tvRoot, item.folder),
			SeriesTitleSortKey: textsort.SortKey(item.title),
			UpdatedAt:          item.updated,
			PosterPath:         filepath.Join(tvRoot, item.folder, "poster.jpg"),
		}
		video.SeriesKey = "key-" + item.folder
		for i := 0; i < item.subs; i++ {
			video.Subtitles = append(video.Subtitles, domain.Subtitle{
				ID:       item.id + "-S" + string(rune('1'+i)),
				Path:     filepath.Join(dir, item.folder+".zh.srt"),
				FileName: item.folder + ".zh.srt",
				Language: "zh",
				Format:   "srt",
				Size:     12,
				ModTime:  item.updated,
			})
		}
		videos = append(videos, video)
	}
	if err := st.SaveScanResult(videos, now, now.Add(time.Second), "", nil); err != nil {
		t.Fatalf("save scan: %v", err)
	}

	page, total, err := st.ListTVSeriesPage("", 1, 2, "year", "desc")
	if err != nil {
		t.Fatalf("list page: %v", err)
	}
	if total != 3 {
		t.Fatalf("total=%d want 3", total)
	}
	if len(page) != 2 {
		t.Fatalf("page len=%d want 2", len(page))
	}
	if page[0].Title != "Alpha" || page[1].Title != "Bravo" {
		t.Fatalf("year desc page1=%v", titles(page))
	}
	page2, _, err := st.ListTVSeriesPage("", 2, 2, "year", "desc")
	if err != nil {
		t.Fatalf("list page2: %v", err)
	}
	if len(page2) != 1 || page2[0].Title != "Charlie" {
		t.Fatalf("year desc page2=%v", titles(page2))
	}

	byCount, _, err := st.ListTVSeriesPage("", 1, 10, "noSubtitleCount", "desc")
	if err != nil {
		t.Fatalf("list noSubtitleCount: %v", err)
	}
	if len(byCount) != 3 || byCount[0].Title != "Bravo" {
		t.Fatalf("noSubtitleCount desc=%v", titles(byCount))
	}

	filtered, filteredTotal, err := st.ListTVSeriesPage("char", 1, 10, "title", "asc")
	if err != nil {
		t.Fatalf("filter: %v", err)
	}
	if filteredTotal != 1 || len(filtered) != 1 || filtered[0].Title != "Charlie" {
		t.Fatalf("filter char: total=%d items=%v", filteredTotal, titles(filtered))
	}
}

func TestListTVSeriesPageUsesLatestNonEmptyTitleAndMatchingSortKey(t *testing.T) {
	st, err := Open(TestDSN(t))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() { _ = st.Close() }()

	now := time.Now().UTC()
	root := filepath.Join(t.TempDir(), "tv")
	showDir := filepath.Join(root, "Show", "Season 1")
	mikeDir := filepath.Join(root, "Mike", "Season 1")
	videos := []domain.Video{
		{
			ID:                 "OLD",
			Path:               filepath.Join(showDir, "Show S01E01.mkv"),
			Directory:          showDir,
			FileName:           "Show S01E01.mkv",
			Title:              "E1",
			MediaType:          domain.MediaTypeTV,
			SeriesTitle:        "Zebra",
			SeriesKey:          "key-show",
			SeriesPath:         filepath.Join(root, "Show"),
			SeriesTitleSortKey: textsort.SortKey("Zebra"),
			UpdatedAt:          now.Add(-time.Hour),
		},
		{
			ID:                 "NEW",
			Path:               filepath.Join(showDir, "Show S01E02.mkv"),
			Directory:          showDir,
			FileName:           "Show S01E02.mkv",
			Title:              "E2",
			MediaType:          domain.MediaTypeTV,
			SeriesTitle:        "Alpha",
			SeriesKey:          "key-show",
			SeriesPath:         filepath.Join(root, "Show"),
			SeriesTitleSortKey: textsort.SortKey("Alpha"),
			UpdatedAt:          now,
		},
		{
			ID:                 "MIKE",
			Path:               filepath.Join(mikeDir, "Mike S01E01.mkv"),
			Directory:          mikeDir,
			FileName:           "Mike S01E01.mkv",
			Title:              "E1",
			MediaType:          domain.MediaTypeTV,
			SeriesTitle:        "Mike",
			SeriesKey:          "key-mike",
			SeriesPath:         filepath.Join(root, "Mike"),
			SeriesTitleSortKey: textsort.SortKey("Mike"),
			UpdatedAt:          now,
		},
	}
	if err := st.SaveScanResult(videos, now, now.Add(time.Second), "", nil); err != nil {
		t.Fatalf("save scan: %v", err)
	}

	page, total, err := st.ListTVSeriesPage("", 1, 10, "title", "asc")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 2 {
		t.Fatalf("total=%d want 2", total)
	}
	if len(page) != 2 || page[0].Title != "Alpha" || page[1].Title != "Mike" {
		t.Fatalf("title asc=%v", titles(page))
	}
}

func titles(items []domain.TVSeriesSummary) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	return out
}
