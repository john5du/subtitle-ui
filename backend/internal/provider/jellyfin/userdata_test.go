package jellyfin

import (
	"errors"
	"testing"
	"time"
)

func TestMergePlaybackItemPlayedWins(t *testing.T) {
	m := map[string]ItemPlayback{}
	mergePlaybackItem(m, playbackItemDTO{Path: "/data/movies/Foo.mkv"}, true)
	mergePlaybackItem(m, playbackItemDTO{
		Path:     "/data/movies/Foo.mkv",
		UserData: userDataDTO{PlaybackPositionTicks: 12},
	}, false)
	st := m[normalizeComparePath("/data/movies/Foo.mkv")]
	if !st.Played || st.InProgress {
		t.Fatalf("played should win: %+v", st)
	}
	if st.PositionTicks != 12 {
		t.Fatalf("ticks=%d", st.PositionTicks)
	}
}

func TestMergePlaybackItemResumable(t *testing.T) {
	m := map[string]ItemPlayback{}
	mergePlaybackItem(m, playbackItemDTO{
		Path:     "/data/tv/Show/S01E01.mkv",
		UserData: userDataDTO{PlaybackPositionTicks: 99},
	}, false)
	st := m[normalizeComparePath("/data/tv/Show/S01E01.mkv")]
	if st.Played || !st.InProgress || st.PositionTicks != 99 {
		t.Fatalf("in progress: %+v", st)
	}
}

func TestMergePlaybackItemUserDataPlayedOnResumable(t *testing.T) {
	m := map[string]ItemPlayback{}
	mergePlaybackItem(m, playbackItemDTO{
		Path:     "/data/movies/Bar.mkv",
		UserData: userDataDTO{Played: true, PlaybackPositionTicks: 5},
	}, false)
	st := m[normalizeComparePath("/data/movies/Bar.mkv")]
	if !st.Played || st.InProgress {
		t.Fatalf("UserData.Played on resumable: %+v", st)
	}
}

func TestMergePlaybackItemSkipsEmptyPath(t *testing.T) {
	m := map[string]ItemPlayback{}
	mergePlaybackItem(m, playbackItemDTO{}, true)
	if len(m) != 0 {
		t.Fatalf("empty path should be skipped: %+v", m)
	}
}

func TestLookupPlaybackUsesPathMap(t *testing.T) {
	c := New(Options{
		Enabled:  true,
		BaseURL:  "http://127.0.0.1:8096",
		APIKey:   "k",
		PathMaps: []PathMap{{From: "/host/movies", To: "/data/movies"}},
	})
	m := map[string]ItemPlayback{
		normalizeComparePath("/data/movies/Foo.mkv"): {Played: true},
	}
	st, ok := c.LookupPlayback("/host/movies/Foo.mkv", m)
	if !ok || !st.Played {
		t.Fatalf("local path should map: ok=%v st=%+v", ok, st)
	}
	st, ok = c.LookupPlayback("/data/movies/Foo.mkv", m)
	if !ok || !st.Played {
		t.Fatalf("already-mapped path: ok=%v st=%+v", ok, st)
	}
	if _, ok := c.LookupPlayback("/host/movies/Missing.mkv", m); ok {
		t.Fatal("missing path")
	}
}

func TestLookupPlaybackCacheMissTTL(t *testing.T) {
	c := New(Options{Enabled: true, BaseURL: "http://127.0.0.1:8096", APIKey: "k"})
	want := errors.New("jellyfin down")
	c.playbackMu.Lock()
	c.playbackCache = &playbackCache{err: want, at: time.Now()}
	_, err, ok := c.lookupPlaybackCacheLocked()
	c.playbackMu.Unlock()
	if !ok || !errors.Is(err, want) {
		t.Fatalf("fresh miss: ok=%v err=%v", ok, err)
	}

	c.playbackMu.Lock()
	c.playbackCache = &playbackCache{err: want, at: time.Now().Add(-playbackCacheMissTTL - time.Second)}
	_, _, ok = c.lookupPlaybackCacheLocked()
	c.playbackMu.Unlock()
	if ok {
		t.Fatal("expired miss should not be served")
	}

	c.playbackMu.Lock()
	c.playbackCache = &playbackCache{byPath: map[string]ItemPlayback{"/a": {Played: true}}, at: time.Now().Add(-playbackCacheTTL - time.Second)}
	_, _, ok = c.lookupPlaybackCacheLocked()
	c.playbackMu.Unlock()
	if ok {
		t.Fatal("expired hit should not be served")
	}
}
