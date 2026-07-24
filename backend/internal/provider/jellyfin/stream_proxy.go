package jellyfin

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// StreamResponse is a live Jellyfin video stream (caller must Close Body).
// StatusCode may be 2xx, 404, or 416 (media-relevant responses are passed through).
type StreamResponse struct {
	StatusCode int
	Header     http.Header
	Body       io.ReadCloser
}

// OpenVideoStream opens a static direct stream for an item (no transcoding, no play reporting).
// Prefer ResolvePlaybackPlan + OpenAuthenticatedPath for browser preview (audio may need AAC).
func (c *Client) OpenVideoStream(ctx context.Context, method, itemID, rangeHeader string) (*StreamResponse, error) {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return nil, fmt.Errorf("item id required")
	}
	q := url.Values{}
	q.Set("static", "true")
	path := "/Videos/" + url.PathEscape(itemID) + "/stream?" + q.Encode()
	return c.OpenAuthenticatedPath(ctx, method, path, rangeHeader)
}

// streamHTTPClient returns a client that shares the configured Transport but has no overall timeout
// (long Range transfers rely on request context cancellation when the browser disconnects).
func (c *Client) streamHTTPClient() *http.Client {
	base := c.client
	if base == nil {
		return &http.Client{Timeout: 0}
	}
	return &http.Client{
		Transport:     base.Transport,
		CheckRedirect: base.CheckRedirect,
		Jar:           base.Jar,
		Timeout:       0,
	}
}

func isPassThroughStreamStatus(code int) bool {
	if code >= 200 && code < 300 {
		return true
	}
	switch code {
	case http.StatusNotFound, http.StatusRequestedRangeNotSatisfiable:
		return true
	default:
		return false
	}
}
