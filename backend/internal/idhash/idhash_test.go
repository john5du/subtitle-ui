package idhash

import "testing"

func TestFromStringStableAndCaseInsensitive(t *testing.T) {
	a := FromString("/Media/Movie.mkv")
	b := FromString("/media/movie.mkv")
	if a == "" || a != b {
		t.Fatalf("expected stable case-insensitive id, got %q vs %q", a, b)
	}
	if FromString("other") == a {
		t.Fatal("different inputs must not collide trivially")
	}
}
