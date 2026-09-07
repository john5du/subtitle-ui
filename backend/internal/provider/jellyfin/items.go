package jellyfin

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type pathIDCacheEntry struct {
	itemID string
	miss   bool // true => cached ErrItemNotFound
	at     time.Time
}

const findItemPageSize = 100
const pathIDHitTTL = 30 * time.Minute
const pathIDMissTTL = 30 * time.Second

// FindItemIDByPath looks up a Movie/Episode id by filesystem path.
//
// Filename SearchTerm is tried first; hits are still confirmed by Path because
// Jellyfin titles often differ from filenames (e.g. Show.S01E01.mkv → "Pilot").
// SearchTerm HTTP errors are logged and ignored so a full Path scan can still match.
// Results are paged until a path match or the library is exhausted.
//
// Hits are cached for pathIDHitTTL to avoid repeated full-library scans. Misses use
// a short pathIDMissTTL so a newly imported file is found on the next preview.
// Call InvalidatePathIDCache after Library/Media/Updated, or when an item API
// returns 404 for a cached id.
func (c *Client) FindItemIDByPath(ctx context.Context, localOrMappedPath string) (string, error) {
	if !c.Enabled() {
		return "", ErrDisabled
	}
	want := c.pathIDCacheKey(localOrMappedPath)
	if want == "" {
		return "", fmt.Errorf("empty path")
	}
	target := c.MapPath(strings.TrimSpace(localOrMappedPath))

	if id, ok, err := c.lookupPathIDCache(want); ok {
		return id, err
	}

	base := filepath.Base(target)
	terms := []string{base}
	if stem := strings.TrimSuffix(base, filepath.Ext(base)); stem != "" && stem != base {
		terms = append(terms, stem)
	}
	for _, term := range terms {
		id, found, err := c.findItemIDBySearchTerm(ctx, want, term)
		if err != nil {
			if ctx.Err() != nil {
				return "", err
			}
			log.Printf("jellyfin SearchTerm %q failed, falling back to path scan: %v", term, err)
			continue
		}
		if found {
			c.storePathIDCache(want, id, false)
			return id, nil
		}
	}

	for start := 0; ; start += findItemPageSize {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		items, err := c.listItemsPage(ctx, start, findItemPageSize, "")
		if err != nil {
			return "", err
		}
		if id, ok := matchItemPath(items, want); ok {
			c.storePathIDCache(want, id, false)
			return id, nil
		}
		if len(items) < findItemPageSize {
			break
		}
	}
	c.storePathIDCache(want, "", true)
	return "", fmt.Errorf("%w for path %s", ErrItemNotFound, target)
}

func (c *Client) findItemIDBySearchTerm(ctx context.Context, want, searchTerm string) (string, bool, error) {
	searchTerm = strings.TrimSpace(searchTerm)
	if searchTerm == "" {
		return "", false, nil
	}
	items, err := c.listItemsPage(ctx, 0, 50, searchTerm)
	if err != nil {
		return "", false, err
	}
	id, ok := matchItemPath(items, want)
	return id, ok, nil
}

func (c *Client) listItemsPage(ctx context.Context, start, limit int, searchTerm string) ([]itemDTO, error) {
	q := url.Values{}
	q.Set("Recursive", "true")
	q.Set("IncludeItemTypes", "Movie,Episode")
	q.Set("Fields", "Path")
	q.Set("EnableImages", "false")
	q.Set("EnableTotalRecordCount", "false")
	q.Set("StartIndex", strconv.Itoa(start))
	q.Set("Limit", strconv.Itoa(limit))
	if strings.TrimSpace(searchTerm) != "" {
		q.Set("SearchTerm", searchTerm)
	}
	var result itemQueryResult
	if err := c.getJSON(ctx, "/Items", q, &result); err != nil {
		return nil, err
	}
	return result.items(), nil
}

func matchItemPath(items []itemDTO, want string) (string, bool) {
	for _, item := range items {
		if normalizeComparePath(item.path()) != want {
			continue
		}
		id := item.id()
		if id != "" {
			return id, true
		}
	}
	return "", false
}

func (c *Client) lookupPathIDCache(key string) (id string, ok bool, err error) {
	c.pathIDMu.Lock()
	defer c.pathIDMu.Unlock()
	if c.pathIDCache == nil {
		return "", false, nil
	}
	entry, found := c.pathIDCache[key]
	if !found {
		return "", false, nil
	}
	ttl := pathIDHitTTL
	if entry.miss {
		ttl = pathIDMissTTL
	}
	if time.Since(entry.at) > ttl {
		delete(c.pathIDCache, key)
		return "", false, nil
	}
	if entry.miss {
		return "", true, ErrItemNotFound
	}
	return entry.itemID, true, nil
}

func (c *Client) storePathIDCache(key, itemID string, miss bool) {
	c.pathIDMu.Lock()
	defer c.pathIDMu.Unlock()
	if c.pathIDCache == nil {
		c.pathIDCache = make(map[string]pathIDCacheEntry)
	}
	c.pathIDCache[key] = pathIDCacheEntry{itemID: itemID, miss: miss, at: time.Now()}
}

// itemIDThen looks up a path, runs fn, and on ErrItemNotFound after a successful
// lookup (stale cached id) drops the cache and retries once.
func (c *Client) itemIDThen(ctx context.Context, localOrMappedPath string, fn func(itemID string) error) (string, error) {
	run := func() (string, error) {
		id, err := c.FindItemIDByPath(ctx, localOrMappedPath)
		if err != nil {
			return "", err
		}
		id = strings.TrimSpace(id)
		if id == "" {
			return "", fmt.Errorf("%w: empty item id", ErrItemNotFound)
		}
		return id, fn(id)
	}
	id, err := run()
	if err == nil || !errors.Is(err, ErrItemNotFound) || id == "" {
		return id, err
	}
	c.InvalidatePathIDCache(localOrMappedPath)
	return run()
}

// InvalidatePathIDCache drops a cached hit or miss for the given local or mapped path.
func (c *Client) InvalidatePathIDCache(localOrMappedPath string) {
	if c == nil {
		return
	}
	key := c.pathIDCacheKey(localOrMappedPath)
	if key == "" {
		return
	}
	c.pathIDMu.Lock()
	defer c.pathIDMu.Unlock()
	delete(c.pathIDCache, key)
}

func (c *Client) pathIDCacheKey(localOrMappedPath string) string {
	if c == nil {
		return ""
	}
	target := c.MapPath(strings.TrimSpace(localOrMappedPath))
	return normalizeComparePath(target)
}

type itemQueryResult struct {
	Items  []itemDTO `json:"Items"`
	ItemsC []itemDTO `json:"items"`
}

func (r itemQueryResult) items() []itemDTO {
	if len(r.Items) > 0 {
		return r.Items
	}
	return r.ItemsC
}

type itemDTO struct {
	ID    string `json:"Id"`
	IDC   string `json:"id"`
	Path  string `json:"Path"`
	PathC string `json:"path"`
}

func (i itemDTO) id() string {
	if strings.TrimSpace(i.ID) != "" {
		return strings.TrimSpace(i.ID)
	}
	return strings.TrimSpace(i.IDC)
}

func (i itemDTO) path() string {
	if strings.TrimSpace(i.Path) != "" {
		return strings.TrimSpace(i.Path)
	}
	return strings.TrimSpace(i.PathC)
}
