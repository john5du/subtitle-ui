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
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	clientName     = "subtitle-ui"
	clientDevice   = "subtitle-ui"
	clientDeviceID = "subtitle-ui"
	clientVersion  = "1.0.0"
)

// Options configures the Jellyfin client.
type Options struct {
	Enabled bool
	BaseURL string
	APIKey  string
	// UserID is optional; used for PlaybackInfo (DeviceProfile requires a real user).
	// When empty, the client auto-picks an admin/non-disabled user via GET /Users.
	UserID     string
	PathMaps   []PathMap
	HTTPClient *http.Client
}

// Client talks to the Jellyfin HTTP API.
type Client struct {
	enabled      bool
	baseURL      string
	apiKey       string
	userID       string // configured override
	pathMaps     []PathMap
	client       *http.Client
	userIDMu     sync.Mutex
	cachedUserID string // auto-resolved when userID empty
	pathIDMu     sync.Mutex
	pathIDCache  map[string]pathIDCacheEntry // key: normalized compare path
}

// ErrDisabled is returned when Jellyfin is not configured.
var ErrDisabled = fmt.Errorf("jellyfin disabled")

// ErrItemNotFound is returned when no Movie/Episode matches the filesystem path.
// Other lookup failures (network, auth, 5xx, decode) return plain errors.
var ErrItemNotFound = fmt.Errorf("jellyfin item not found")

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
		enabled:     opts.Enabled && base != "" && strings.TrimSpace(opts.APIKey) != "",
		baseURL:     base,
		apiKey:      strings.TrimSpace(opts.APIKey),
		userID:      strings.TrimSpace(opts.UserID),
		pathMaps:    maps,
		client:      hc,
		pathIDCache: make(map[string]pathIDCacheEntry),
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
		return jellyfinRequestError(http.MethodGet, path, resp.StatusCode, sample)
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
		return jellyfinRequestError(http.MethodPost, path, resp.StatusCode, sample)
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

func jellyfinRequestError(method, path string, statusCode int, sample string) error {
	msg := fmt.Sprintf("jellyfin %s %s: %s", method, path, jellyfinHTTPError(statusCode, sample))
	if statusCode == http.StatusNotFound && isJellyfinItemPath(path) {
		return fmt.Errorf("%w: %s", ErrItemNotFound, msg)
	}
	return fmt.Errorf("%s", msg)
}

func isJellyfinItemPath(path string) bool {
	if i := strings.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	return strings.HasPrefix(path, "/Items/")
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

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
