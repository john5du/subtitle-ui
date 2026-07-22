package jellyfin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Options configures the Jellyfin client.
type Options struct {
	Enabled    bool
	BaseURL    string
	APIKey     string
	PathMaps   []PathMap
	HTTPClient *http.Client
}

// PathMap rewrites local media paths to paths Jellyfin sees.
type PathMap struct {
	From string
	To   string
}

// Client talks to the Jellyfin HTTP API.
type Client struct {
	enabled  bool
	baseURL  string
	apiKey   string
	pathMaps []PathMap
	client   *http.Client
}

// ErrDisabled is returned when Jellyfin is not configured.
var ErrDisabled = fmt.Errorf("jellyfin disabled")

// NormalizeBaseURL validates and normalizes a Jellyfin base URL.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("empty jellyfin url")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid jellyfin url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return "", fmt.Errorf("jellyfin url must use http or https")
	}
	if u.Host == "" {
		return "", fmt.Errorf("jellyfin url missing host")
	}
	u.Fragment = ""
	u.RawQuery = ""
	return strings.TrimRight(u.String(), "/"), nil
}

// ParsePathMaps parses "from:to,from2:to2" into path maps.
// From/to may be absolute paths; longer From prefixes win when mapping.
func ParsePathMaps(raw string) ([]PathMap, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]PathMap, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		from, to, ok := splitPathMapPair(part)
		if !ok {
			return nil, fmt.Errorf("invalid path map entry %q (want from:to)", part)
		}
		from = normalizeMapPath(from)
		to = normalizeMapPath(to)
		if from == "" || to == "" {
			return nil, fmt.Errorf("invalid path map entry %q (empty from/to)", part)
		}
		out = append(out, PathMap{From: from, To: to})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return len(out[i].From) > len(out[j].From)
	})
	return out, nil
}

// FormatPathMaps serializes path maps back to the env/DB string form.
func FormatPathMaps(maps []PathMap) string {
	if len(maps) == 0 {
		return ""
	}
	parts := make([]string, 0, len(maps))
	for _, m := range maps {
		from := strings.TrimSpace(m.From)
		to := strings.TrimSpace(m.To)
		if from == "" || to == "" {
			continue
		}
		parts = append(parts, from+":"+to)
	}
	return strings.Join(parts, ",")
}

// New creates a Jellyfin client. When disabled, methods return ErrDisabled.
func New(opts Options) *Client {
	base := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if normalized, err := NormalizeBaseURL(base); err == nil {
		base = normalized
	}
	hc := opts.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	maps := make([]PathMap, 0, len(opts.PathMaps))
	for _, m := range opts.PathMaps {
		from := normalizeMapPath(m.From)
		to := normalizeMapPath(m.To)
		if from == "" || to == "" {
			continue
		}
		maps = append(maps, PathMap{From: from, To: to})
	}
	sort.SliceStable(maps, func(i, j int) bool {
		return len(maps[i].From) > len(maps[j].From)
	})
	return &Client{
		enabled:  opts.Enabled && base != "" && strings.TrimSpace(opts.APIKey) != "",
		baseURL:  base,
		apiKey:   strings.TrimSpace(opts.APIKey),
		pathMaps: maps,
		client:   hc,
	}
}

// Enabled reports whether the client is configured on.
func (c *Client) Enabled() bool {
	return c != nil && c.enabled
}

// Ping checks URL + API key via GET /System/Info.
func (c *Client) Ping(ctx context.Context) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	var info map[string]any
	if err := c.getJSON(ctx, "/System/Info", nil, &info); err != nil {
		return err
	}
	return nil
}

// PhysicalPaths returns library physical roots from GET /Library/PhysicalPaths.
func (c *Client) PhysicalPaths(ctx context.Context) ([]string, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	var paths []string
	if err := c.getJSON(ctx, "/Library/PhysicalPaths", nil, &paths); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// ValidatePathMaps checks configured map targets against Jellyfin library roots.
// When no path maps are set, returns nil. When maps are set but none match, returns an error.
func (c *Client) ValidatePathMaps(ctx context.Context) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	if len(c.pathMaps) == 0 {
		return nil
	}
	physical, err := c.PhysicalPaths(ctx)
	if err != nil {
		return fmt.Errorf("list library paths: %w", err)
	}
	if len(physical) == 0 {
		return fmt.Errorf("jellyfin returned no library physical paths")
	}
	unmatched := make([]string, 0)
	for _, m := range c.pathMaps {
		if !pathMapTargetMatchesLibrary(m.To, physical) {
			unmatched = append(unmatched, m.From+":"+m.To)
		}
	}
	if len(unmatched) == 0 {
		return nil
	}
	known := make([]string, 0, len(physical))
	for _, p := range physical {
		known = append(known, normalizeMapPath(p))
	}
	return fmt.Errorf("path map target(s) not under any Jellyfin library root: %s (library roots: %s)",
		strings.Join(unmatched, ", "),
		strings.Join(known, ", "))
}

// pathMapTargetMatchesLibrary reports whether mapTo equals, contains, or is contained by a library root.
func pathMapTargetMatchesLibrary(mapTo string, physical []string) bool {
	to := normalizeMapPath(mapTo)
	if to == "" {
		return false
	}
	for _, p := range physical {
		root := normalizeMapPath(p)
		if root == "" {
			continue
		}
		if to == root || pathHasPrefix(to, root) || pathHasPrefix(root, to) {
			return true
		}
	}
	return false
}

// PathMaps returns a copy of configured path maps.
func (c *Client) PathMaps() []PathMap {
	if c == nil || len(c.pathMaps) == 0 {
		return nil
	}
	out := make([]PathMap, len(c.pathMaps))
	copy(out, c.pathMaps)
	return out
}

// MapPath rewrites a local path using configured path maps.
func (c *Client) MapPath(localPath string) string {
	if c == nil {
		return localPath
	}
	return MapPath(localPath, c.pathMaps)
}

// MapPath rewrites localPath using maps (longest From prefix wins).
func MapPath(localPath string, maps []PathMap) string {
	localPath = strings.TrimSpace(localPath)
	if localPath == "" || len(maps) == 0 {
		return localPath
	}
	normalized := normalizeMapPath(localPath)
	for _, m := range maps {
		if pathHasPrefix(normalized, m.From) {
			rest := strings.TrimPrefix(normalized, m.From)
			rest = strings.TrimPrefix(rest, "/")
			if rest == "" {
				return m.To
			}
			return joinMapped(m.To, rest)
		}
	}
	return localPath
}

// ReportMediaUpdated notifies Jellyfin that media paths changed.
func (c *Client) ReportMediaUpdated(ctx context.Context, paths []string) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	updates := make([]mediaUpdatePath, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		mapped := c.MapPath(p)
		if _, ok := seen[mapped]; ok {
			continue
		}
		seen[mapped] = struct{}{}
		updates = append(updates, mediaUpdatePath{
			Path:       mapped,
			UpdateType: "Modified",
		})
	}
	if len(updates) == 0 {
		return fmt.Errorf("no paths to report")
	}
	body := mediaUpdateInfo{Updates: updates}
	return c.postJSON(ctx, "/Library/Media/Updated", body, nil)
}

// RefreshItem queues a ValidationOnly metadata refresh for one item.
func (c *Client) RefreshItem(ctx context.Context, itemID string) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return fmt.Errorf("item id required")
	}
	q := url.Values{}
	q.Set("metadataRefreshMode", "ValidationOnly")
	q.Set("imageRefreshMode", "None")
	return c.postJSON(ctx, "/Items/"+url.PathEscape(itemID)+"/Refresh?"+q.Encode(), nil, nil)
}

// FindItemIDByPath looks up a Movie/Episode id by filesystem path.
func (c *Client) FindItemIDByPath(ctx context.Context, localOrMappedPath string) (string, error) {
	if !c.Enabled() {
		return "", ErrDisabled
	}
	target := c.MapPath(strings.TrimSpace(localOrMappedPath))
	if target == "" {
		return "", fmt.Errorf("empty path")
	}
	base := filepath.Base(target)
	searchTerm := strings.TrimSuffix(base, filepath.Ext(base))
	if searchTerm == "" {
		searchTerm = base
	}

	q := url.Values{}
	q.Set("Recursive", "true")
	q.Set("IncludeItemTypes", "Movie,Episode")
	q.Set("Fields", "Path")
	q.Set("EnableImages", "false")
	q.Set("EnableTotalRecordCount", "false")
	if searchTerm != "" {
		q.Set("SearchTerm", searchTerm)
	}
	q.Set("Limit", "50")

	var result itemQueryResult
	if err := c.getJSON(ctx, "/Items", q, &result); err != nil {
		return "", err
	}
	want := normalizeComparePath(target)
	for _, item := range result.items() {
		if normalizeComparePath(item.path()) == want {
			id := item.id()
			if id != "" {
				return id, nil
			}
		}
	}
	return "", fmt.Errorf("item not found for path %s", target)
}

// NotifyVideoChanged reports a video path change; falls back to item refresh.
func (c *Client) NotifyVideoChanged(ctx context.Context, localVideoPath string) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	localVideoPath = strings.TrimSpace(localVideoPath)
	if localVideoPath == "" {
		return fmt.Errorf("empty video path")
	}
	if err := c.ReportMediaUpdated(ctx, []string{localVideoPath}); err == nil {
		return nil
	} else {
		log.Printf("jellyfin Media/Updated failed path=%s err=%v; trying Items/Refresh", localVideoPath, err)
		mediaErr := err
		itemID, findErr := c.FindItemIDByPath(ctx, localVideoPath)
		if findErr != nil {
			return fmt.Errorf("media updated: %v; find item: %w", mediaErr, findErr)
		}
		if err := c.RefreshItem(ctx, itemID); err != nil {
			return fmt.Errorf("media updated: %v; refresh %s: %w", mediaErr, itemID, err)
		}
		return nil
	}
}

type mediaUpdateInfo struct {
	Updates []mediaUpdatePath `json:"Updates"`
}

type mediaUpdatePath struct {
	Path       string `json:"Path"`
	UpdateType string `json:"UpdateType"`
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

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, dest any) error {
	u := c.baseURL + path
	if query != nil && len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		log.Printf("jellyfin GET failed path=%s err=%v", path, err)
		return err
	}
	c.setAuth(req)
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("jellyfin GET network failed path=%s err=%v", path, err)
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		log.Printf("jellyfin GET read failed path=%s err=%v", path, err)
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		sample := truncate(string(body), 200)
		log.Printf("jellyfin GET failed path=%s status=%s bodySample=%q", path, resp.Status, sample)
		return fmt.Errorf("jellyfin GET %s: %s", path, jellyfinHTTPError(resp.StatusCode, sample))
	}
	if dest == nil {
		return nil
	}
	if err := json.Unmarshal(body, dest); err != nil {
		log.Printf("jellyfin decode failed method=GET path=%s bodyBytes=%d err=%v", path, len(body), err)
		return fmt.Errorf("jellyfin decode %s: %w", path, err)
	}
	return nil
}

func (c *Client) postJSON(ctx context.Context, path string, payload any, dest any) error {
	var reader io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			log.Printf("jellyfin POST marshal failed path=%s err=%v", path, err)
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, reader)
	if err != nil {
		log.Printf("jellyfin POST request failed path=%s err=%v", path, err)
		return err
	}
	c.setAuth(req)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("jellyfin POST network failed path=%s err=%v", path, err)
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		log.Printf("jellyfin POST read failed path=%s err=%v", path, err)
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		sample := truncate(string(body), 200)
		log.Printf("jellyfin POST failed path=%s status=%s bodySample=%q", path, resp.Status, sample)
		return fmt.Errorf("jellyfin POST %s: %s", path, jellyfinHTTPError(resp.StatusCode, sample))
	}
	if dest == nil || len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, dest); err != nil {
		log.Printf("jellyfin decode failed method=POST path=%s bodyBytes=%d err=%v", path, len(body), err)
		return fmt.Errorf("jellyfin decode %s: %w", path, err)
	}
	return nil
}

func jellyfinHTTPError(statusCode int, sample string) string {
	switch statusCode {
	case http.StatusUnauthorized:
		msg := "401 Unauthorized (check API key; create one in Dashboard → API Keys)"
		if sample != "" {
			return msg + ": " + sample
		}
		return msg
	case http.StatusForbidden:
		msg := "403 Forbidden (API key lacks permission)"
		if sample != "" {
			return msg + ": " + sample
		}
		return msg
	default:
		if sample != "" {
			return fmt.Sprintf("%d: %s", statusCode, sample)
		}
		return fmt.Sprintf("%d", statusCode)
	}
}

func (c *Client) setAuth(req *http.Request) {
	token := strings.TrimSpace(c.apiKey)
	// Full MediaBrowser header is required when Jellyfin has EnableLegacyAuthorization=false
	// (X-Emby-Token alone is ignored in that mode). Token values are URL-encoded like official clients.
	esc := url.QueryEscape
	req.Header.Set("Authorization", fmt.Sprintf(
		`MediaBrowser Client="%s", Device="%s", DeviceId="%s", Version="%s", Token="%s"`,
		esc(clientName),
		esc(clientDevice),
		esc(clientDeviceID),
		esc(clientVersion),
		esc(token),
	))
	// Legacy headers for older servers / EnableLegacyAuthorization=true.
	req.Header.Set("X-Emby-Token", token)
	req.Header.Set("X-MediaBrowser-Token", token)
}

const (
	clientName     = "subtitle-ui"
	clientDevice   = "subtitle-ui"
	clientDeviceID = "subtitle-ui"
	clientVersion  = "1.0.0"
)

func splitPathMapPair(part string) (from, to string, ok bool) {
	// Prefer last colon that still leaves a non-empty "to" (Windows drive letters: C:/a:D:/b).
	// Strategy: split on ":" but if from looks like Windows drive (X) and more remains, keep going.
	idx := strings.Index(part, ":")
	if idx <= 0 {
		return "", "", false
	}
	// Handle "C:/movies:/data/movies" style: first segment is a Windows drive letter.
	if len(part) > 2 && part[1] == ':' && (part[2] == '/' || part[2] == '\\') {
		j := strings.Index(part[2:], ":")
		if j < 0 {
			return "", "", false
		}
		j += 2
		from = part[:j]
		to = part[j+1:]
		if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
			return "", "", false
		}
		return from, to, true
	}
	// General: split on first ":" (POSIX paths don't contain colon).
	from = part[:idx]
	to = part[idx+1:]
	if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
		return "", "", false
	}
	// If "to" also starts with Windows drive, keep as-is (first colon split is wrong only when from has drive).
	return from, to, true
}

func normalizeMapPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, "\\", "/")
	for strings.Contains(p, "//") {
		// Keep leading // for UNC? treat as single-host media paths.
		if strings.HasPrefix(p, "//") {
			rest := strings.TrimLeft(p[2:], "/")
			p = "//" + rest
			// collapse remaining
			for strings.Contains(p[2:], "//") {
				p = p[:2] + strings.ReplaceAll(p[2:], "//", "/")
			}
			break
		}
		p = strings.ReplaceAll(p, "//", "/")
	}
	if len(p) > 1 && strings.HasSuffix(p, "/") {
		p = strings.TrimRight(p, "/")
	}
	return p
}

func pathHasPrefix(path, prefix string) bool {
	if path == prefix {
		return true
	}
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	if len(path) == len(prefix) {
		return true
	}
	// boundary: next rune must be /
	return path[len(prefix)] == '/'
}

func joinMapped(root, rest string) string {
	root = strings.TrimRight(root, "/")
	rest = strings.TrimLeft(rest, "/")
	if root == "" {
		return rest
	}
	if rest == "" {
		return root
	}
	return root + "/" + rest
}

func normalizeComparePath(p string) string {
	p = normalizeMapPath(p)
	return strings.ToLower(p)
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
