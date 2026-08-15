package app

import (
	"context"
	"log"
	"strings"
	"time"
)

// notifyJellyfinAfterSubtitleChange queues an async Jellyfin library notify for one video.
// Failures are logged only; callers must not treat this as part of the write transaction.
func (s *Service) notifyJellyfinAfterSubtitleChange(videoID string) {
	if s == nil {
		return
	}
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return
	}
	videoID = strings.TrimSpace(videoID)
	if videoID == "" {
		return
	}
	video, err := s.GetVideo(videoID)
	if err != nil {
		return
	}
	path := strings.TrimSpace(video.Path)
	if path == "" {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := client.NotifyVideoChanged(ctx, path); err != nil {
			log.Printf("jellyfin notify failed videoId=%s path=%s err=%v", videoID, path, err)
			s.recordOp("jellyfin_notify", videoID, path, "", "error", err.Error())
			return
		}
		s.recordOp("jellyfin_notify", videoID, path, "", "ok", "media updated or item refreshed")
	}()
}
