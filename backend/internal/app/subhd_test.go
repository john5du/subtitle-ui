package app

import (
	"testing"

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

func TestMapSubHDError(t *testing.T) {
	err := mapSubHDError(subhd.ErrRateLimited)
	if err == nil {
		t.Fatal("expected error")
	}
	if mapSubHDError(subhd.ErrDisabled) != ErrProviderDisabled {
		t.Fatal("disabled mapping")
	}
}
