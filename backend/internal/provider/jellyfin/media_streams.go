package jellyfin

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// MediaStream is a subset of Jellyfin MediaStream used for subtitle track listing.
type MediaStream struct {
	Index             int    `json:"Index"`
	Type              string `json:"Type"`
	Codec             string `json:"Codec"`
	Language          string `json:"Language"`
	Title             string `json:"Title"`
	DisplayTitle      string `json:"DisplayTitle"`
	IsExternal        bool   `json:"IsExternal"`
	IsTextSubtitle    bool   `json:"IsTextSubtitleStream"`
	IsForced          bool   `json:"IsForced"`
	IsDefault         bool   `json:"IsDefault"`
	IsHearingImpaired bool   `json:"IsHearingImpaired"`
}

type playbackStreamsResponse struct {
	MediaSources []playbackStreamsSrc `json:"MediaSources"`
}

type playbackStreamsSrc struct {
	MediaStreams  []MediaStream `json:"MediaStreams"`
	MediaStreamsC []MediaStream `json:"mediaStreams"`
}

func (s playbackStreamsSrc) streams() []MediaStream {
	if len(s.MediaStreams) > 0 {
		return s.MediaStreams
	}
	return s.MediaStreamsC
}

// ListMediaStreams returns media streams for a Jellyfin item.
// Uses PlaybackInfo (same path as stream preview) — GET /Items/{id}?Fields=… returns 400 on some servers.
func (c *Client) ListMediaStreams(ctx context.Context, itemID string) ([]MediaStream, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return nil, fmt.Errorf("item id required")
	}
	userID, err := c.resolvePlaybackUserID(ctx)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"UserId": userID,
	}
	var resp playbackStreamsResponse
	q := url.Values{}
	q.Set("UserId", userID)
	path := "/Items/" + url.PathEscape(itemID) + "/PlaybackInfo?" + q.Encode()
	if err := c.postJSON(ctx, path, body, &resp); err != nil {
		return nil, err
	}
	if len(resp.MediaSources) == 0 {
		return nil, fmt.Errorf("%w: no media sources", ErrItemNotFound)
	}
	return append([]MediaStream(nil), resp.MediaSources[0].streams()...), nil
}

// EmbeddedSubtitleStreams filters to embedded (non-external) subtitle tracks.
func EmbeddedSubtitleStreams(streams []MediaStream) []MediaStream {
	out := make([]MediaStream, 0, len(streams))
	for _, s := range streams {
		if !strings.EqualFold(strings.TrimSpace(s.Type), "Subtitle") {
			continue
		}
		if s.IsExternal {
			continue
		}
		out = append(out, s)
	}
	return out
}
