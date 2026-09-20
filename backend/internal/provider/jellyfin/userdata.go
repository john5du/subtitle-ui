package jellyfin

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	playbackCacheTTL     = 2 * time.Minute
	playbackCacheMissTTL = 30 * time.Second
	playbackFetchTimeout = 15 * time.Second
	userdataPageSize     = 100
	filterIsPlayed       = "IsPlayed"
	filterIsResumable    = "IsResumable"
)

// ItemPlayback is user-scoped watch state for one Movie/Episode path.
type ItemPlayback struct {
	Played        bool
	InProgress    bool
	PositionTicks int64
}

type playbackCache struct {
	byPath map[string]ItemPlayback
	err    error
	at     time.Time
}

type playbackInflight struct {
	done   chan struct{}
	byPath map[string]ItemPlayback
	err    error
}

// PlaybackByPath returns Jellyfin played/in-progress items keyed by normalized
// Jellyfin path. Results are cached for playbackCacheTTL with single-flight refresh.
func (c *Client) PlaybackByPath(ctx context.Context) (map[string]ItemPlayback, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	c.playbackMu.Lock()
	if m, err, ok := c.lookupPlaybackCacheLocked(); ok {
		c.playbackMu.Unlock()
		return m, err
	}
	if inf := c.playbackInflight; inf != nil {
		c.playbackMu.Unlock()
		return waitPlaybackInflight(ctx, inf)
	}
	inf := &playbackInflight{done: make(chan struct{})}
	c.playbackInflight = inf
	c.playbackMu.Unlock()

	go c.runPlaybackFetch(inf)
	return waitPlaybackInflight(ctx, inf)
}

func (c *Client) lookupPlaybackCacheLocked() (map[string]ItemPlayback, error, bool) {
	cache := c.playbackCache
	if cache == nil {
		return nil, nil, false
	}
	ttl := playbackCacheTTL
	if cache.err != nil {
		ttl = playbackCacheMissTTL
	}
	if time.Since(cache.at) >= ttl {
		c.playbackCache = nil
		return nil, nil, false
	}
	return cache.byPath, cache.err, true
}

func waitPlaybackInflight(ctx context.Context, inf *playbackInflight) (map[string]ItemPlayback, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-inf.done:
		return inf.byPath, inf.err
	}
}

func (c *Client) runPlaybackFetch(inf *playbackInflight) {
	fetchCtx, cancel := context.WithTimeout(context.Background(), playbackFetchTimeout)
	defer cancel()
	byPath, err := c.fetchPlaybackByPath(fetchCtx)

	c.playbackMu.Lock()
	inf.byPath, inf.err = byPath, err
	c.playbackCache = &playbackCache{byPath: byPath, err: err, at: time.Now()}
	c.playbackInflight = nil
	close(inf.done)
	c.playbackMu.Unlock()
}

// LookupPlayback maps a local (or already-mapped) path through path maps into m.
func (c *Client) LookupPlayback(localOrMappedPath string, m map[string]ItemPlayback) (ItemPlayback, bool) {
	if c == nil || len(m) == 0 {
		return ItemPlayback{}, false
	}
	key := c.pathIDCacheKey(localOrMappedPath)
	if key == "" {
		return ItemPlayback{}, false
	}
	st, ok := m[key]
	return st, ok
}

func (c *Client) fetchPlaybackByPath(ctx context.Context) (map[string]ItemPlayback, error) {
	userID, err := c.resolvePlaybackUserID(ctx)
	if err != nil {
		return nil, err
	}
	played, err := c.listUserItemsFiltered(ctx, userID, filterIsPlayed)
	if err != nil {
		return nil, err
	}
	resumable, err := c.listUserItemsFiltered(ctx, userID, filterIsResumable)
	if err != nil {
		return nil, err
	}
	out := make(map[string]ItemPlayback, len(played)+len(resumable))
	for _, item := range played {
		mergePlaybackItem(out, item, true)
	}
	for _, item := range resumable {
		mergePlaybackItem(out, item, false)
	}
	return out, nil
}

func (c *Client) listUserItemsFiltered(ctx context.Context, userID, filter string) ([]playbackItemDTO, error) {
	var all []playbackItemDTO
	for start := 0; ; start += userdataPageSize {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := c.listUserItemsPage(ctx, userID, filter, start, userdataPageSize)
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if len(page) < userdataPageSize {
			break
		}
	}
	return all, nil
}

func (c *Client) listUserItemsPage(ctx context.Context, userID, filter string, start, limit int) ([]playbackItemDTO, error) {
	q := url.Values{}
	q.Set("Recursive", "true")
	q.Set("IncludeItemTypes", "Movie,Episode")
	q.Set("Fields", "Path,UserData")
	q.Set("EnableImages", "false")
	q.Set("EnableTotalRecordCount", "false")
	q.Set("StartIndex", strconv.Itoa(start))
	q.Set("Limit", strconv.Itoa(limit))
	if strings.TrimSpace(filter) != "" {
		q.Set("Filters", filter)
	}
	path := "/Users/" + url.PathEscape(strings.TrimSpace(userID)) + "/Items"
	var result playbackQueryResult
	if err := c.getJSON(ctx, path, q, &result); err != nil {
		return nil, err
	}
	return result.items(), nil
}

func mergePlaybackItem(dst map[string]ItemPlayback, item playbackItemDTO, fromPlayedFilter bool) {
	key := normalizeComparePath(item.path())
	if key == "" {
		return
	}
	ud := item.userData()
	next := ItemPlayback{PositionTicks: ud.positionTicks()}
	if fromPlayedFilter || ud.played() {
		next.Played = true
	} else {
		next.InProgress = true
	}
	prev, ok := dst[key]
	if !ok {
		dst[key] = next
		return
	}
	if prev.Played || next.Played {
		ticks := prev.PositionTicks
		if next.PositionTicks > ticks {
			ticks = next.PositionTicks
		}
		dst[key] = ItemPlayback{Played: true, PositionTicks: ticks}
		return
	}
	ticks := prev.PositionTicks
	if next.PositionTicks > ticks {
		ticks = next.PositionTicks
	}
	dst[key] = ItemPlayback{InProgress: true, PositionTicks: ticks}
}

type playbackQueryResult struct {
	Items  []playbackItemDTO `json:"Items"`
	ItemsC []playbackItemDTO `json:"items"`
}

func (r playbackQueryResult) items() []playbackItemDTO {
	if len(r.Items) > 0 {
		return r.Items
	}
	return r.ItemsC
}

type playbackItemDTO struct {
	ID        string      `json:"Id"`
	IDC       string      `json:"id"`
	Path      string      `json:"Path"`
	PathC     string      `json:"path"`
	UserData  userDataDTO `json:"UserData"`
	UserDataC userDataDTO `json:"userData"`
}

func (i playbackItemDTO) path() string {
	if strings.TrimSpace(i.Path) != "" {
		return strings.TrimSpace(i.Path)
	}
	return strings.TrimSpace(i.PathC)
}

func (i playbackItemDTO) userData() userDataDTO {
	if i.UserData.present() {
		return i.UserData
	}
	return i.UserDataC
}

type userDataDTO struct {
	Played                 bool  `json:"Played"`
	PlayedC                bool  `json:"played"`
	PlaybackPositionTicks  int64 `json:"PlaybackPositionTicks"`
	PlaybackPositionTicksC int64 `json:"playbackPositionTicks"`
}

func (u userDataDTO) present() bool {
	return u.Played || u.PlayedC || u.PlaybackPositionTicks > 0 || u.PlaybackPositionTicksC > 0
}

func (u userDataDTO) played() bool {
	return u.Played || u.PlayedC
}

func (u userDataDTO) positionTicks() int64 {
	if u.PlaybackPositionTicks > 0 {
		return u.PlaybackPositionTicks
	}
	return u.PlaybackPositionTicksC
}
