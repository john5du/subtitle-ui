package subhd

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	xproxy "golang.org/x/net/proxy"
)

const defaultUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

// Options configures the SubHD client.
type Options struct {
	Enabled     bool
	BaseURL     string
	UserAgent   string
	MinInterval time.Duration
	// ProxyURL optional outbound proxy, e.g. socks5://127.0.0.1:1080 or socks://host:port.
	ProxyURL string
	// HTTPClient optional custom client (tests). When set, ProxyURL is ignored.
	HTTPClient *http.Client
}

// Client talks to SubHD (search HTML + download API).
type Client struct {
	enabled   bool
	baseURL   string
	userAgent string
	client    *http.Client
	limiter   *limiter

	parseSearches       atomic.Int64
	parseOK             atomic.Int64
	parseEmpty          atomic.Int64
	parseLayoutWarnings atomic.Int64
	parseCardWarnings   atomic.Int64
}

// New creates a SubHD client. When disabled, methods return ErrDisabled.
func New(opts Options) *Client {
	base := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if base == "" {
		base = "https://subhd.tv"
	}
	ua := strings.TrimSpace(opts.UserAgent)
	if ua == "" {
		ua = defaultUserAgent
	}
	hc := opts.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 60 * time.Second}
		if transport, err := buildTransport(opts.ProxyURL); err == nil && transport != nil {
			hc.Transport = transport
		}
	}
	return &Client{
		enabled:   opts.Enabled,
		baseURL:   base,
		userAgent: ua,
		client:    hc,
		limiter:   newLimiter(opts.MinInterval),
	}
}

// NormalizeBaseURL validates and normalizes a SubHD site base URL.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("empty base url")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid base url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return "", fmt.Errorf("base url must use http or https")
	}
	if u.Host == "" {
		return "", fmt.Errorf("base url missing host")
	}
	u.Fragment = ""
	u.RawQuery = ""
	return strings.TrimRight(u.String(), "/"), nil
}

// NormalizeProxyURL validates an optional outbound proxy URL.
// Empty input returns ("", nil).
func NormalizeProxyURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	normalized := raw
	if strings.HasPrefix(strings.ToLower(normalized), "socks://") {
		normalized = "socks5://" + normalized[len("socks://"):]
	}
	if strings.HasPrefix(strings.ToLower(normalized), "socks5h://") {
		normalized = "socks5://" + normalized[len("socks5h://"):]
	}
	u, err := url.Parse(normalized)
	if err != nil {
		return "", fmt.Errorf("invalid proxy url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "socks5", "socks5h", "socks", "http", "https":
	default:
		return "", fmt.Errorf("unsupported proxy scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("proxy url missing host")
	}
	return normalized, nil
}

func buildTransport(proxyRaw string) (http.RoundTripper, error) {
	proxyRaw, err := NormalizeProxyURL(proxyRaw)
	if err != nil {
		return nil, err
	}
	if proxyRaw == "" {
		return nil, nil
	}
	u, err := url.Parse(proxyRaw)
	if err != nil {
		return nil, err
	}
	switch strings.ToLower(u.Scheme) {
	case "socks5", "socks5h", "socks":
		dialer, err := xproxy.FromURL(u, xproxy.Direct)
		if err != nil {
			return nil, err
		}
		contextDialer, ok := dialer.(xproxy.ContextDialer)
		transport := &http.Transport{
			Proxy:                 nil,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          10,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		}
		if ok {
			transport.DialContext = contextDialer.DialContext
		} else {
			transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.Dial(network, addr)
			}
		}
		return transport, nil
	case "http", "https":
		return &http.Transport{
			Proxy:                 http.ProxyURL(u),
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          10,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", u.Scheme)
	}
}

// Enabled reports whether the provider is turned on.
func (c *Client) Enabled() bool {
	return c != nil && c.enabled
}

// ParseStats returns cumulative search HTML parse telemetry for this client.
func (c *Client) ParseStats() ParseStats {
	if c == nil {
		return ParseStats{}
	}
	return ParseStats{
		Searches:       c.parseSearches.Load(),
		ParseOK:        c.parseOK.Load(),
		EmptyResults:   c.parseEmpty.Load(),
		LayoutWarnings: c.parseLayoutWarnings.Load(),
		CardWarnings:   c.parseCardWarnings.Load(),
	}
}

func (c *Client) recordSearchParse(itemCount int, warning string) {
	if c == nil {
		return
	}
	c.parseSearches.Add(1)
	switch warning {
	case WarningHTMLLayout:
		c.parseLayoutWarnings.Add(1)
	case WarningCardsUnparsed:
		c.parseCardWarnings.Add(1)
	default:
		if itemCount == 0 {
			c.parseEmpty.Add(1)
		} else {
			c.parseOK.Add(1)
		}
	}
}

// PageURL returns the SubHD detail page URL for a subtitle sid.
func (c *Client) PageURL(sid string) string {
	sid = strings.TrimSpace(sid)
	if c == nil || sid == "" {
		return ""
	}
	return c.absURL("/a/" + sid)
}

func (c *Client) requireEnabled() error {
	if c == nil || !c.enabled {
		return ErrDisabled
	}
	return nil
}

func (c *Client) absURL(path string) string {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return c.baseURL + path
}

func (c *Client) setCommonHeaders(req *http.Request, referer string) {
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
}

func encodeSearchPath(query string) (string, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return "", ErrEmptyQuery
	}
	// SubHD uses path segment: /search/{query} with URL encoding
	return url.PathEscape(q), nil
}

func wrapProvider(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %v", ErrProvider, err)
}
