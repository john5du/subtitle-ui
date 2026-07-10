package app

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

const subhdPackCacheTTL = 30 * time.Minute
const subhdPackCacheMaxEntries = 8

type subhdPackCacheEntry struct {
	SID      string
	FileName string
	Data     []byte
	ExpireAt time.Time
}

type subhdPackCache struct {
	mu      sync.Mutex
	entries map[string]subhdPackCacheEntry
}

func newSubHDPackCache() *subhdPackCache {
	return &subhdPackCache{entries: make(map[string]subhdPackCacheEntry)}
}

func (c *subhdPackCache) put(sid, fileName string, data []byte) string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.purgeExpiredLocked(time.Now())
	for len(c.entries) >= subhdPackCacheMaxEntries {
		// Drop arbitrary oldest-ish entry (first key).
		for key := range c.entries {
			delete(c.entries, key)
			break
		}
	}
	token := randomToken(16)
	c.entries[token] = subhdPackCacheEntry{
		SID:      sid,
		FileName: fileName,
		Data:     data,
		ExpireAt: time.Now().Add(subhdPackCacheTTL),
	}
	return token
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
			delete(c.entries, token)
		}
		return subhdPackCacheEntry{}, false
	}
	return entry, true
}

func (c *subhdPackCache) purgeExpiredLocked(now time.Time) {
	for key, entry := range c.entries {
		if now.After(entry.ExpireAt) {
			delete(c.entries, key)
		}
	}
}

func randomToken(nBytes int) string {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(buf)
}
