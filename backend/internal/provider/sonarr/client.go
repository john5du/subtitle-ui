package sonarr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Options configures the Sonarr client.
type Options struct {
	Enabled    bool
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
	CacheTTL   time.Duration
}

// Client talks to Sonarr v3 API.
type Client struct {
	enabled bool
	baseURL string
	apiKey  string
	client  *http.Client

	cacheTTL time.Duration
	mu       sync.Mutex
	seriesAt time.Time
	series   []Series
}

// Series is a Sonarr series resource (fields we use).
type Series struct {
	ID     int    `json:"id"`
	Title  string `json:"title"`
	Path   string `json:"path"`
	Status string `json:"status"`
	Ended  bool   `json:"ended"`
	TmdbID int    `json:"tmdbId"`
	ImdbID string `json:"imdbId"`
	TvdbID int    `json:"tvdbId"`
}

// Episode is a Sonarr episode resource (fields we use).
type Episode struct {
	ID            int    `json:"id"`
	SeriesID      int    `json:"seriesId"`
	SeasonNumber  int    `json:"seasonNumber"`
	EpisodeNumber int    `json:"episodeNumber"`
	Title         string `json:"title"`
	AirDate       string `json:"airDate"`
	AirDateUTC    string `json:"airDateUtc"`
	HasFile       bool   `json:"hasFile"`
	Monitored     bool   `json:"monitored"`
}

// CommandResult is the response from POST /api/v3/command.
type CommandResult struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// NormalizeBaseURL validates and normalizes a Sonarr base URL.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("empty sonarr url")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid sonarr url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return "", fmt.Errorf("sonarr url must use http or https")
	}
	if u.Host == "" {
		return "", fmt.Errorf("sonarr url missing host")
	}
	u.Fragment = ""
	u.RawQuery = ""
	return strings.TrimRight(u.String(), "/"), nil
}

// New creates a Sonarr client. When disabled, methods return ErrDisabled.
func New(opts Options) *Client {
	base := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if normalized, err := NormalizeBaseURL(base); err == nil {
		base = normalized
	}
	ttl := opts.CacheTTL
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	hc := opts.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		enabled:  opts.Enabled && base != "" && strings.TrimSpace(opts.APIKey) != "",
		baseURL:  base,
		apiKey:   strings.TrimSpace(opts.APIKey),
		client:   hc,
		cacheTTL: ttl,
	}
}

// Enabled reports whether the client is configured on.
func (c *Client) Enabled() bool {
	return c != nil && c.enabled
}

// ErrDisabled is returned when Sonarr is not configured.
var ErrDisabled = fmt.Errorf("sonarr disabled")

// ListSeries returns all series (cached).
func (c *Client) ListSeries(ctx context.Context) ([]Series, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.series) > 0 && time.Since(c.seriesAt) < c.cacheTTL {
		out := make([]Series, len(c.series))
		copy(out, c.series)
		return out, nil
	}
	var rows []Series
	if err := c.getJSON(ctx, "/api/v3/series", nil, &rows); err != nil {
		return nil, err
	}
	c.series = rows
	c.seriesAt = time.Now()
	out := make([]Series, len(rows))
	copy(out, rows)
	return out, nil
}

// InvalidateSeriesCache drops the cached series list.
func (c *Client) InvalidateSeriesCache() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.series = nil
	c.seriesAt = time.Time{}
}

// ListEpisodes returns episodes for a series, optionally filtered by season.
func (c *Client) ListEpisodes(ctx context.Context, seriesID int, seasonNumber int) ([]Episode, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	q := url.Values{}
	q.Set("seriesId", strconv.Itoa(seriesID))
	if seasonNumber >= 0 {
		q.Set("seasonNumber", strconv.Itoa(seasonNumber))
	}
	var rows []Episode
	if err := c.getJSON(ctx, "/api/v3/episode", q, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// EpisodeSearch queues a search for the given Sonarr episode IDs.
func (c *Client) EpisodeSearch(ctx context.Context, episodeIDs []int) (CommandResult, error) {
	if !c.Enabled() {
		return CommandResult{}, ErrDisabled
	}
	if len(episodeIDs) == 0 {
		return CommandResult{}, fmt.Errorf("episodeIds required")
	}
	body := map[string]any{
		"name":       "EpisodeSearch",
		"episodeIds": episodeIDs,
	}
	var result CommandResult
	if err := c.postJSON(ctx, "/api/v3/command", body, &result); err != nil {
		return CommandResult{}, err
	}
	return result, nil
}

// SeasonSearch queues a search for a whole season.
func (c *Client) SeasonSearch(ctx context.Context, seriesID int, seasonNumber int) (CommandResult, error) {
	if !c.Enabled() {
		return CommandResult{}, ErrDisabled
	}
	body := map[string]any{
		"name":         "SeasonSearch",
		"seriesId":     seriesID,
		"seasonNumber": seasonNumber,
	}
	var result CommandResult
	if err := c.postJSON(ctx, "/api/v3/command", body, &result); err != nil {
		return CommandResult{}, err
	}
	return result, nil
}

// FindSeries matches a local series by path, TMDB id, or IMDb id.
func FindSeries(series []Series, localPath string, tmdbID string, imdbID string) (Series, bool) {
	localNorm := normalizePath(localPath)
	tmdb := strings.TrimSpace(tmdbID)
	imdb := strings.ToLower(strings.TrimSpace(imdbID))

	if localNorm != "" {
		for _, s := range series {
			if pathsMatch(localNorm, normalizePath(s.Path)) {
				return s, true
			}
		}
	}
	if tmdb != "" {
		for _, s := range series {
			if s.TmdbID > 0 && strconv.Itoa(s.TmdbID) == tmdb {
				return s, true
			}
		}
	}
	if imdb != "" {
		for _, s := range series {
			if strings.ToLower(strings.TrimSpace(s.ImdbID)) == imdb {
				return s, true
			}
		}
	}
	return Series{}, false
}

func pathsMatch(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	// Suffix match for container vs host path roots.
	if strings.HasSuffix(a, b) || strings.HasSuffix(b, a) {
		return true
	}
	// Compare last two path segments (Show Name / optional).
	aBase := pathTail(a, 2)
	bBase := pathTail(b, 2)
	if aBase != "" && aBase == bBase {
		return true
	}
	return pathTail(a, 1) != "" && pathTail(a, 1) == pathTail(b, 1)
}

func pathTail(p string, n int) string {
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	if n > len(parts) {
		n = len(parts)
	}
	return strings.Join(parts[len(parts)-n:], "/")
}

func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.ToLower(p)
	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	return strings.TrimRight(p, "/")
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, dest any) error {
	u := c.baseURL + path
	if query != nil && len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		log.Printf("sonarr GET failed path=%s err=%v", path, err)
		return err
	}
	req.Header.Set("X-Api-Key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("sonarr GET network failed path=%s err=%v", path, err)
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		log.Printf("sonarr GET read failed path=%s err=%v", path, err)
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		sample := truncate(string(body), 200)
		log.Printf("sonarr GET failed path=%s status=%s bodySample=%q", path, resp.Status, sample)
		return fmt.Errorf("sonarr GET %s: %s: %s", path, resp.Status, sample)
	}
	if dest == nil {
		return nil
	}
	if err := json.Unmarshal(body, dest); err != nil {
		log.Printf("sonarr decode failed method=GET path=%s bodyBytes=%d err=%v", path, len(body), err)
		return fmt.Errorf("sonarr decode %s: %w", path, err)
	}
	return nil
}

func (c *Client) postJSON(ctx context.Context, path string, payload any, dest any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("sonarr POST marshal failed path=%s err=%v", path, err)
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		log.Printf("sonarr POST request failed path=%s err=%v", path, err)
		return err
	}
	req.Header.Set("X-Api-Key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("sonarr POST network failed path=%s err=%v", path, err)
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		log.Printf("sonarr POST read failed path=%s err=%v", path, err)
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		sample := truncate(string(body), 200)
		log.Printf("sonarr POST failed path=%s status=%s bodySample=%q", path, resp.Status, sample)
		return fmt.Errorf("sonarr POST %s: %s: %s", path, resp.Status, sample)
	}
	if dest == nil || len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, dest); err != nil {
		log.Printf("sonarr decode failed method=POST path=%s bodyBytes=%d err=%v", path, len(body), err)
		return fmt.Errorf("sonarr decode %s: %w", path, err)
	}
	return nil
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
