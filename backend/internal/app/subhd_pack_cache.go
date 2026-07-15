package app

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	subhdPackCacheTTL        = 30 * time.Minute
	subhdPackCacheMaxEntries = 8
	// Per-entry cap: season packs are typically well under this; larger blobs are refused.
	subhdPackCacheMaxBytes = 64 << 20 // 64 MiB
)

type subhdPackCacheEntry struct {
	SID      string
	FileName string
	URL      string
	// Data is set only for tiny payloads kept in memory (tests / tiny files).
	Data     []byte
	// DiskPath is preferred storage for real downloads to bound RSS.
	DiskPath string
	Size     int
	ExpireAt time.Time
}

type subhdPackCache struct {
	mu      sync.Mutex
	dir     string
	entries map[string]subhdPackCacheEntry
	// memoryThreshold: payloads at or below this stay in RAM; larger spill to disk.
	memoryThreshold int
	maxBytes        int
	maxEntries      int
	ttl             time.Duration
}

func newSubHDPackCache() *subhdPackCache {
	dir := filepath.Join(os.TempDir(), "subtitle-ui-subhd-pack")
	return &subhdPackCache{
		dir:             dir,
		entries:         make(map[string]subhdPackCacheEntry),
		memoryThreshold: 1 << 20, // 1 MiB
		maxBytes:        subhdPackCacheMaxBytes,
		maxEntries:      subhdPackCacheMaxEntries,
		ttl:             subhdPackCacheTTL,
	}
}

func (c *subhdPackCache) put(sid, fileName, downloadURL string, data []byte) (string, error) {
	if c == nil {
		return "", fmt.Errorf("pack cache unavailable")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("empty pack payload")
	}
	if len(data) > c.maxBytes {
		return "", fmt.Errorf("pack too large to cache (%d bytes, max %d)", len(data), c.maxBytes)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.purgeExpiredLocked(time.Now())
	for len(c.entries) >= c.maxEntries {
		c.evictOldestLocked()
	}

	token := randomToken(16)
	entry := subhdPackCacheEntry{
		SID:      sid,
		FileName: fileName,
		URL:      downloadURL,
		Size:     len(data),
		ExpireAt: time.Now().Add(c.ttl),
	}

	if len(data) <= c.memoryThreshold {
		// Copy so callers can reuse their buffer.
		entry.Data = append([]byte(nil), data...)
	} else {
		if err := os.MkdirAll(c.dir, 0o700); err != nil {
			return "", fmt.Errorf("pack cache dir: %w", err)
		}
		path := filepath.Join(c.dir, token+".bin")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return "", fmt.Errorf("pack cache write: %w", err)
		}
		entry.DiskPath = path
	}

	c.entries[token] = entry
	return token, nil
}

func (c *subhdPackCache) get(token string) (subhdPackCacheEntry, bool) {
	if c == nil {
		return subhdPackCacheEntry{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	c.purgeExpiredLocked(now)
	entry, ok := c.entries[token]
	if !ok || now.After(entry.ExpireAt) {
		if ok {
			c.removeLocked(token, entry)
		}
		return subhdPackCacheEntry{}, false
	}
	if entry.DiskPath != "" && len(entry.Data) == 0 {
		data, err := os.ReadFile(entry.DiskPath)
		if err != nil {
			c.removeLocked(token, entry)
			return subhdPackCacheEntry{}, false
		}
		entry.Data = data
	}
	return entry, true
}

func (c *subhdPackCache) purgeExpiredLocked(now time.Time) {
	for key, entry := range c.entries {
		if now.After(entry.ExpireAt) {
			c.removeLocked(key, entry)
		}
	}
}

func (c *subhdPackCache) evictOldestLocked() {
	var oldestKey string
	var oldestAt time.Time
	for key, entry := range c.entries {
		if oldestKey == "" || entry.ExpireAt.Before(oldestAt) {
			oldestKey = key
			oldestAt = entry.ExpireAt
		}
	}
	if oldestKey == "" {
		return
	}
	c.removeLocked(oldestKey, c.entries[oldestKey])
}

func (c *subhdPackCache) removeLocked(key string, entry subhdPackCacheEntry) {
	delete(c.entries, key)
	if entry.DiskPath != "" {
		_ = os.Remove(entry.DiskPath)
	}
}

func randomToken(nBytes int) string {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(buf)
}
