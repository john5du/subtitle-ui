package jellyfin

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// MediaStream is a subset of Jellyfin MediaStream used for subtitle track listing.
type MediaStream struct {
	Index              int    `json:"Index"`
	Type               string `json:"Type"`
	Codec              string `json:"Codec"`
	Language           string `json:"Language"`
	Title              string `json:"Title"`
	DisplayTitle       string `json:"DisplayTitle"`
	IsExternal         bool   `json:"IsExternal"`
	IsTextSubtitle     bool   `json:"IsTextSubtitleStream"`
	IsForced           bool   `json:"IsForced"`
	IsDefault          bool   `json:"IsDefault"`
	IsHearingImpaired  bool   `json:"IsHearingImpaired"`
}

type itemWithStreamsDTO struct {
	ID            string        `json:"Id"`
	IDC           string        `json:"id"`
	MediaStreams  []MediaStream `json:"MediaStreams"`
	MediaStreamsC []MediaStream `json:"mediaStreams"`
}

func (i itemWithStreamsDTO) streams() []MediaStream {
	if len(i.MediaStreams) > 0 {
		return i.MediaStreams
	}
	return i.MediaStreamsC
}

// ListMediaStreams returns media streams for a Jellyfin item (GET /Items/{id}?fields=MediaStreams).
func (c *Client) ListMediaStreams(ctx context.Context, itemID string) ([]MediaStream, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return nil, fmt.Errorf("item id required")
	}
	q := url.Values{}
	q.Set("Fields", "MediaStreams")
	var item itemWithStreamsDTO
	path := "/Items/" + url.PathEscape(itemID)
	if err := c.getJSON(ctx, path, q, &item); err != nil {
		return nil, err
	}
	streams := append([]MediaStream(nil), item.streams()...)
	return streams, nil
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
