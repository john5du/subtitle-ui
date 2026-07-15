package app

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSubHDPackCacheMemoryAndDisk(t *testing.T) {
	dir := t.TempDir()
	c := &subhdPackCache{
		dir:             dir,
		entries:         make(map[string]subhdPackCacheEntry),
		memoryThreshold: 8,
		maxBytes:        1 << 20,
		maxEntries:      2,
		ttl:             time.Minute,
	}

	small := []byte("tiny")
	tokenSmall, err := c.put("s1", "a.srt", "http://x/a", small)
	if err != nil {
		t.Fatalf("put small: %v", err)
	}
	got, ok := c.get(tokenSmall)
	if !ok || !bytes.Equal(got.Data, small) {
		t.Fatalf("small get: ok=%v data=%q", ok, got.Data)
	}
	if got.DiskPath != "" {
		t.Fatalf("small should stay in memory")
	}

	large := bytes.Repeat([]byte("Z"), 32)
	tokenLarge, err := c.put("s2", "pack.zip", "http://x/b", large)
	if err != nil {
		t.Fatalf("put large: %v", err)
	}
	got, ok = c.get(tokenLarge)
	if !ok || !bytes.Equal(got.Data, large) {
		t.Fatalf("large get: ok=%v len=%d", ok, len(got.Data))
	}
	if got.DiskPath == "" {
		t.Fatal("large should spill to disk")
	}
	if _, err := os.Stat(got.DiskPath); err != nil {
		t.Fatalf("disk file missing: %v", err)
	}

	// Evict oldest when full.
	_, err = c.put("s3", "c.srt", "", []byte("next"))
	if err != nil {
		t.Fatalf("put third: %v", err)
	}
	if _, ok := c.get(tokenSmall); ok {
		t.Fatal("expected oldest entry evicted")
	}
}

func TestSubHDPackCacheRejectsOversized(t *testing.T) {
	c := &subhdPackCache{
		dir:             t.TempDir(),
		entries:         make(map[string]subhdPackCacheEntry),
		memoryThreshold: 1,
		maxBytes:        10,
		maxEntries:      4,
		ttl:             time.Minute,
	}
	if _, err := c.put("sid", "x.zip", "", make([]byte, 11)); err == nil {
		t.Fatal("expected size error")
	}
}

func TestSubHDPackCacheExpiryRemovesDisk(t *testing.T) {
	dir := t.TempDir()
	c := &subhdPackCache{
		dir:             dir,
		entries:         make(map[string]subhdPackCacheEntry),
		memoryThreshold: 1,
		maxBytes:        1 << 20,
		maxEntries:      4,
		ttl:             20 * time.Millisecond,
	}
	token, err := c.put("sid", "pack.zip", "", bytes.Repeat([]byte("a"), 8))
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	c.mu.Lock()
	path := c.entries[token].DiskPath
	c.mu.Unlock()
	if path == "" {
		t.Fatal("expected disk path")
	}
	time.Sleep(40 * time.Millisecond)
	if _, ok := c.get(token); ok {
		t.Fatal("expected expired")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("disk file should be removed, err=%v", err)
	}
	// dir should not keep orphan bins for this token
	matches, _ := filepath.Glob(filepath.Join(dir, "*.bin"))
	if len(matches) != 0 {
		t.Fatalf("orphan files: %v", matches)
	}
}
