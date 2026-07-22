package jellyfin

import (
	"testing"
)

func TestNormalizeBaseURL(t *testing.T) {
	got, err := NormalizeBaseURL(" http://127.0.0.1:8096/ ")
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if got != "http://127.0.0.1:8096" {
		t.Fatalf("got %q", got)
	}
	if _, err := NormalizeBaseURL("ftp://x"); err == nil {
		t.Fatalf("expected error for ftp")
	}
	if _, err := NormalizeBaseURL(""); err == nil {
		t.Fatalf("expected error for empty")
	}
}

func TestParsePathMapsAndMapPath(t *testing.T) {
	maps, err := ParsePathMaps("/host/movies:/data/movies,/host/tv:/data/tv")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(maps) != 2 {
		t.Fatalf("len=%d", len(maps))
	}
	// longer prefix first
	if maps[0].From != "/host/movies" && maps[0].From != "/host/tv" {
		t.Fatalf("unexpected order: %+v", maps)
	}

	got := MapPath("/host/movies/Foo/Foo.mkv", maps)
	if got != "/data/movies/Foo/Foo.mkv" {
		t.Fatalf("map movie: %q", got)
	}
	got = MapPath("/host/tv/Show/S01E01.mkv", maps)
	if got != "/data/tv/Show/S01E01.mkv" {
		t.Fatalf("map tv: %q", got)
	}
	got = MapPath("/other/file.mkv", maps)
	if got != "/other/file.mkv" {
		t.Fatalf("unmapped: %q", got)
	}

	// prefix boundary: /host/movie should not match /host/movies
	maps2, err := ParsePathMaps("/host/movie:/data/movie")
	if err != nil {
		t.Fatalf("parse2: %v", err)
	}
	if MapPath("/host/movies/x.mkv", maps2) != "/host/movies/x.mkv" {
		t.Fatalf("prefix boundary failed")
	}

	if _, err := ParsePathMaps("nocolon"); err == nil {
		t.Fatalf("expected invalid entry error")
	}
}

func TestFormatPathMaps(t *testing.T) {
	s := FormatPathMaps([]PathMap{
		{From: "/a", To: "/b"},
		{From: "/c", To: "/d"},
	})
	if s != "/a:/b,/c:/d" {
		t.Fatalf("got %q", s)
	}
}

func TestClientMapPathUsesMaps(t *testing.T) {
	c := New(Options{
		Enabled: true,
		BaseURL: "http://127.0.0.1:8096",
		APIKey:  "k",
		PathMaps: []PathMap{
			{From: "/local", To: "/remote"},
		},
	})
	if !c.Enabled() {
		t.Fatalf("expected enabled")
	}
	if got := c.MapPath("/local/x.mkv"); got != "/remote/x.mkv" {
		t.Fatalf("got %q", got)
	}
}

func TestDisabledClient(t *testing.T) {
	c := New(Options{Enabled: true, BaseURL: "http://x", APIKey: ""})
	if c.Enabled() {
		t.Fatalf("expected disabled without key")
	}
}
