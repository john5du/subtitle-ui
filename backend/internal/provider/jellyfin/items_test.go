package jellyfin

import (
	"errors"
	"testing"
	"time"
)

func TestPathIDCacheHitMissAndInvalidate(t *testing.T) {
	c := New(Options{
		Enabled:  true,
		BaseURL:  "http://127.0.0.1:8096",
		APIKey:   "k",
		PathMaps: []PathMap{{From: "/host/movies", To: "/data/movies"}},
	})
	local := "/host/movies/Foo.mkv"
	key := c.pathIDCacheKey(local)
	if key != c.pathIDCacheKey("/data/movies/Foo.mkv") {
		t.Fatalf("local and mapped paths must share cache key")
	}

	c.storePathIDCache(key, "item-1", false)
	id, ok, err := c.lookupPathIDCache(key)
	if !ok || err != nil || id != "item-1" {
		t.Fatalf("hit: id=%q ok=%v err=%v", id, ok, err)
	}

	c.storePathIDCache(key, "", true)
	id, ok, err = c.lookupPathIDCache(key)
	if !ok || !errors.Is(err, ErrItemNotFound) || id != "" {
		t.Fatalf("miss: id=%q ok=%v err=%v", id, ok, err)
	}

	c.InvalidatePathIDCache(local)
	if _, ok, _ = c.lookupPathIDCache(key); ok {
		t.Fatal("expected empty cache after invalidate")
	}
}

func TestPathIDCacheTTLExpiry(t *testing.T) {
	c := New(Options{Enabled: true, BaseURL: "http://127.0.0.1:8096", APIKey: "k"})
	key := c.pathIDCacheKey("/data/movies/Foo.mkv")

	c.pathIDMu.Lock()
	c.pathIDCache[key] = pathIDCacheEntry{itemID: "old", at: time.Now().Add(-pathIDHitTTL - time.Second)}
	c.pathIDMu.Unlock()
	if _, ok, _ := c.lookupPathIDCache(key); ok {
		t.Fatal("expired hit should not be served")
	}

	c.pathIDMu.Lock()
	c.pathIDCache[key] = pathIDCacheEntry{miss: true, at: time.Now().Add(-pathIDMissTTL - time.Second)}
	c.pathIDMu.Unlock()
	if _, ok, _ := c.lookupPathIDCache(key); ok {
		t.Fatal("expired miss should not be served")
	}

	c.pathIDMu.Lock()
	c.pathIDCache[key] = pathIDCacheEntry{miss: true, at: time.Now().Add(-time.Second)}
	c.pathIDMu.Unlock()
	_, ok, err := c.lookupPathIDCache(key)
	if !ok || !errors.Is(err, ErrItemNotFound) {
		t.Fatalf("fresh miss should be served, ok=%v err=%v", ok, err)
	}
}
