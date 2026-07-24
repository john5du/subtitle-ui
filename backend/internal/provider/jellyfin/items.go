package jellyfin

import (
	"context"
	"fmt"
	"net/url"
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
const pathIDHitTTL = 2 * time.Minute
const pathIDMissTTL = 30 * time.Second

// FindItemIDByPath looks up a Movie/Episode id by filesystem path.
//
// Matching is by Path only (not SearchTerm/metadata title). Jellyfin titles often
// differ from filenames (e.g. Show.S01E01.mkv → "Pilot"), so name search would
// drop the real item. Results are paged until a path match or the library is exhausted.
// Successful and not-found results are cached briefly to avoid repeated full-library scans.
func (c *Client) FindItemIDByPath(ctx context.Context, localOrMappedPath string) (string, error) {
	if !c.Enabled() {
		return "", ErrDisabled
	}
	target := c.MapPath(strings.TrimSpace(localOrMappedPath))
	if target == "" {
		return "", fmt.Errorf("empty path")
	}
	want := normalizeComparePath(target)
	if want == "" {
		return "", fmt.Errorf("empty path")
	}

	if id, ok, err := c.lookupPathIDCache(want); ok {
		return id, err
	}

	for start := 0; ; start += findItemPageSize {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		q := url.Values{}
		q.Set("Recursive", "true")
		q.Set("IncludeItemTypes", "Movie,Episode")
		q.Set("Fields", "Path")
		q.Set("EnableImages", "false")
		q.Set("EnableTotalRecordCount", "false")
		q.Set("StartIndex", strconv.Itoa(start))
		q.Set("Limit", strconv.Itoa(findItemPageSize))

		var result itemQueryResult
		if err := c.getJSON(ctx, "/Items", q, &result); err != nil {
			// Preserve upstream/network/auth errors; do not mask as not-found.
			return "", err
		}
		items := result.items()
		for _, item := range items {
			if normalizeComparePath(item.path()) != want {
				continue
			}
			id := item.id()
			if id != "" {
				c.storePathIDCache(want, id, false)
				return id, nil
			}
		}
		if len(items) < findItemPageSize {
			break
		}
	}
	c.storePathIDCache(want, "", true)
	return "", fmt.Errorf("%w for path %s", ErrItemNotFound, target)
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
