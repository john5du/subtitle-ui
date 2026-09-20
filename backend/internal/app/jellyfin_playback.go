package app

import (
	"context"
	"log"
	"time"

	"subtitle-ui/backend/internal/domain"
)

const jellyfinPlaybackAttachTimeout = 15 * time.Second

// AttachJellyfinPlayback fills Video.Playback from Jellyfin UserData when enabled.
// Failures are logged and ignored so library list/get still succeed.
func (s *Service) AttachJellyfinPlayback(ctx context.Context, videos []domain.Video) {
	if s == nil || len(videos) == 0 {
		return
	}
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, jellyfinPlaybackAttachTimeout)
	defer cancel()

	byPath, err := client.PlaybackByPath(ctx)
	if err != nil {
		log.Printf("jellyfin playback attach skipped: %v", err)
		return
	}
	for i := range videos {
		st, ok := client.LookupPlayback(videos[i].Path, byPath)
		if !ok {
			continue
		}
		pb := domain.VideoPlayback{
			Played:     st.Played,
			InProgress: !st.Played && (st.InProgress || st.PositionTicks > 0),
		}
		if !pb.Played && !pb.InProgress {
			continue
		}
		videos[i].Playback = &pb
	}
}
