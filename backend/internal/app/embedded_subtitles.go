package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

// EmbeddedSubtitleTrack is one embedded subtitle stream from the container (via Jellyfin).
type EmbeddedSubtitleTrack struct {
	Index        int    `json:"index"`
	Language     string `json:"language"`
	Title        string `json:"title,omitempty"`
	DisplayTitle string `json:"displayTitle,omitempty"`
	Codec        string `json:"codec,omitempty"`
	IsForced     bool   `json:"isForced"`
	IsDefault    bool   `json:"isDefault"`
	IsText       bool   `json:"isText"`
}

// EmbeddedSubtitleList is the response for listing embedded subtitle tracks.
type EmbeddedSubtitleList struct {
	Tracks []EmbeddedSubtitleTrack `json:"tracks"`
}

// ListEmbeddedSubtitles returns embedded (muxed) subtitle tracks for a library video via Jellyfin.
func (s *Service) ListEmbeddedSubtitles(ctx context.Context, videoID string) (EmbeddedSubtitleList, error) {
	videoID = strings.TrimSpace(videoID)
	if videoID == "" {
		return EmbeddedSubtitleList{}, fmt.Errorf("%w: video id required", ErrBadRequest)
	}
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return EmbeddedSubtitleList{}, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
	}
	video, err := s.GetVideo(videoID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return EmbeddedSubtitleList{}, fmt.Errorf("%w: video", ErrNotFound)
		}
		return EmbeddedSubtitleList{}, err
	}
	if strings.TrimSpace(video.Path) == "" {
		return EmbeddedSubtitleList{}, fmt.Errorf("%w: video path", ErrNotFound)
	}
	streams, err := client.ListMediaStreamsForPath(ctx, video.Path)
	if err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return EmbeddedSubtitleList{}, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		if errors.Is(err, jellyfin.ErrItemNotFound) {
			return EmbeddedSubtitleList{}, fmt.Errorf("%w: jellyfin item: %w", ErrNotFound, err)
		}
		if strings.Contains(err.Error(), "empty path") {
			return EmbeddedSubtitleList{}, fmt.Errorf("%w: jellyfin path: %w", ErrNotFound, err)
		}
		return EmbeddedSubtitleList{}, fmt.Errorf("jellyfin media streams: %w", err)
	}
	embedded := jellyfin.EmbeddedSubtitleStreams(streams)
	tracks := make([]EmbeddedSubtitleTrack, 0, len(embedded))
	for _, st := range embedded {
		tracks = append(tracks, mapEmbeddedSubtitleTrack(st))
	}
	return EmbeddedSubtitleList{Tracks: tracks}, nil
}

func mapEmbeddedSubtitleTrack(st jellyfin.MediaStream) EmbeddedSubtitleTrack {
	lang := strings.TrimSpace(st.Language)
	if lang == "" {
		lang = "und"
	}
	return EmbeddedSubtitleTrack{
		Index:        st.Index,
		Language:     lang,
		Title:        strings.TrimSpace(st.Title),
		DisplayTitle: strings.TrimSpace(st.DisplayTitle),
		Codec:        strings.TrimSpace(st.Codec),
		IsForced:     st.IsForced,
		IsDefault:    st.IsDefault,
		IsText:       st.IsTextSubtitle,
	}
}
