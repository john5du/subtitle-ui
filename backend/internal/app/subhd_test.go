package app

import (
	"testing"

	"subtitle-ui/backend/internal/archive"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
)

func TestBuildSubHDQuery(t *testing.T) {
	q := buildSubHDQuery(domain.Video{
		Title:         "沙丘2",
		OriginalTitle: "Dune: Part Two",
		Year:          "2024",
		FileName:      "Dune.Part.Two.2024.mkv",
	})
	if q != "Dune: Part Two 2024" {
		t.Fatalf("got %q", q)
	}

	q = buildSubHDQuery(domain.Video{
		MediaType:   domain.MediaTypeTV,
		Title:       "Platform Zero",
		SeriesTitle: "Daredevil",
		FileName:    "Show.S01E05.mkv",
	})
	if q != "Daredevil S01E05" {
		t.Fatalf("tv got %q", q)
	}
}

func TestBuildSubHDSeasonQuery(t *testing.T) {
	q := BuildSubHDSeasonQuery(domain.Video{
		MediaType:           domain.MediaTypeTV,
		SeriesOriginalTitle: "Daredevil",
		FileName:            "Show.S01E05.mkv",
	}, 1)
	if q != "Daredevil S01" {
		t.Fatalf("got %q", q)
	}
}

func TestParseSeasonEpisodeNumbers(t *testing.T) {
	se := parseSeasonEpisodeNumbers("Show.S01E05.chs.srt")
	if se == nil || se.Season != 1 || se.Episode != 5 {
		t.Fatalf("got %+v", se)
	}
	se = parseSeasonEpisodeNumbers("Show.1x02.ass")
	if se == nil || se.Season != 1 || se.Episode != 2 {
		t.Fatalf("got %+v", se)
	}
}

func TestPickDoubanIDFromSearch(t *testing.T) {
	items := []subhd.SearchResult{
		{DoubanID: "111", Title: "Other", Version: "S02E01"},
		{DoubanID: "35908203", Title: "夜魔侠：重生 第一季", Version: "S01E01"},
		{DoubanID: "35908203", Title: "夜魔侠：重生 第一季", Version: "S01E02"},
	}
	id := pickDoubanIDFromSearch(items, "Daredevil S01", 1)
	if id != "35908203" {
		t.Fatalf("got %q", id)
	}
}

func TestScoreSubHDSeasonPack(t *testing.T) {
	pack := subhd.SearchResult{
		Installable: true,
		Title:       "Daredevil",
		Version:     "S01 合集 简体",
		Langs:       []string{"简体"},
		Format:      "",
	}
	ep := subhd.SearchResult{
		Installable: true,
		Title:       "Daredevil",
		Version:     "S01E05",
		Langs:       []string{"英语"},
		Format:      "SRT",
	}
	if ScoreSubHDSeasonPack(pack, 1) <= ScoreSubHDSeasonPack(ep, 1) {
		t.Fatalf("pack should score higher")
	}
}

func TestSuggestSeasonPackMappings(t *testing.T) {
	videos := []domain.Video{
		{ID: "v1", FileName: "Show.S01E01.mkv", Path: "/a/1.mkv"},
		{ID: "v2", FileName: "Show.S01E02.mkv", Path: "/a/2.mkv"},
	}
	entries := []archive.Entry{
		{Path: "S01E01.chs.srt", FileName: "S01E01.chs.srt", Size: 10},
		{Path: "S01E01.eng.srt", FileName: "S01E01.eng.srt", Size: 10},
		{Path: "S01E02.chs.srt", FileName: "S01E02.chs.srt", Size: 10},
	}
	suggested, _ := suggestSeasonPackMappings(videos, entries, "simplified", "any", "zh", false)
	if len(suggested) != 2 {
		t.Fatalf("want 2 mappings, got %+v", suggested)
	}
	byVideo := map[string]string{}
	for _, m := range suggested {
		byVideo[m.VideoID] = m.ArchiveEntry
	}
	if byVideo["v1"] != "S01E01.chs.srt" {
		t.Fatalf("v1 entry %q", byVideo["v1"])
	}
	if byVideo["v2"] != "S01E02.chs.srt" {
		t.Fatalf("v2 entry %q", byVideo["v2"])
	}
}

func TestMapSubHDError(t *testing.T) {
	err := mapSubHDError(subhd.ErrRateLimited)
	if err == nil {
		t.Fatal("expected error")
	}
	if mapSubHDError(subhd.ErrDisabled) != ErrProviderDisabled {
		t.Fatal("disabled mapping")
	}
}

func TestInferLabelFromSubHD(t *testing.T) {
	tests := []struct {
		name string
		file string
		src  string
		want string
	}{
		{name: "chs only", file: "Show.S01E01.chs.srt", want: "zh"},
		{name: "eng only", file: "Show.S01E01.eng.srt", want: "en"},
		{name: "bilingual tokens", file: "Show.S01E01.chs&eng.ass", want: "zh&en"},
		{name: "chinese chars", file: "官方字幕 简体.srt", want: "zh"},
		{name: "bilingual chinese", file: "双语 简体 英语.ass", want: "zh&en"},
		{name: "unknown defaults zh not subhd", file: "pack.srt", src: "archive.zip", want: "zh"},
		{name: "en not false-positive in episode", file: "Show.S01E01.chs.srt", src: "season.pack", want: "zh"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := inferLabelFromSubHD(&subhd.ResolvedSubtitle{FileName: tt.file, Source: tt.src})
			if got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
	if got := inferLabelFromSubHD(nil); got != "zh" {
		t.Fatalf("nil got %q", got)
	}
}
