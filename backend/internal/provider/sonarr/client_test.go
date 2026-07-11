package sonarr

import "testing"

func TestPathsMatch(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"/media/tv/Show", "/media/tv/Show", true},
		{"/data/tv/Show", "/media/tv/Show", true},
		{"/media/tv/Show Name", "/tv/Show Name", true},
		{"/media/tv/Alpha", "/media/tv/Beta", false},
		{"", "/media/tv/Show", false},
	}
	for _, tc := range cases {
		got := pathsMatch(normalizePath(tc.a), normalizePath(tc.b))
		if got != tc.want {
			t.Fatalf("pathsMatch(%q,%q)=%v want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestFindSeries(t *testing.T) {
	series := []Series{
		{ID: 1, Path: "/data/tv/Daredevil", TmdbID: 202555, ImdbID: "tt18923754"},
		{ID: 2, Path: "/data/tv/Other", TmdbID: 1, ImdbID: "tt0000001"},
	}
	if s, ok := FindSeries(series, "/media/tv/Daredevil", "", ""); !ok || s.ID != 1 {
		t.Fatalf("path match failed: %+v ok=%v", s, ok)
	}
	if s, ok := FindSeries(series, "", "202555", ""); !ok || s.ID != 1 {
		t.Fatalf("tmdb match failed: %+v ok=%v", s, ok)
	}
	if s, ok := FindSeries(series, "", "", "tt18923754"); !ok || s.ID != 1 {
		t.Fatalf("imdb match failed: %+v ok=%v", s, ok)
	}
	if _, ok := FindSeries(series, "/x/unknown", "999", "tt999"); ok {
		t.Fatal("expected no match")
	}
}
