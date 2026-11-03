package app

import (
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/version"
)

func (s *Service) ListVideosPage(query string, mediaType string, directory string, page int, pageSize int, sortBy string, sortOrder string) (domain.VideoPage, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 200 {
		pageSize = 200
	}

	videos, total, err := s.store.ListVideos(query, mediaType, directory, page, pageSize, sortBy, sortOrder)
	if err != nil {
		return domain.VideoPage{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return domain.VideoPage{
		Items:      videos,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (s *Service) VersionInfo() domain.VersionInfo {
	return domain.VersionInfo{
		Version:      version.Value,
		DatabaseType: s.store.DatabaseType(),
	}
}

func (s *Service) GetVideo(videoID string) (domain.Video, error) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, err
	}
	if !found {
		return domain.Video{}, ErrNotFound
	}
	return video, nil
}

func (s *Service) listAllTVVideos() ([]domain.Video, error) {
	return s.listAllVideosByType(domain.MediaTypeTV)
}

func (s *Service) listAllVideos() ([]domain.Video, error) {
	return s.listAllVideosByType("")
}

func (s *Service) listAllVideosMeta() ([]domain.Video, error) {
	return s.store.ListAllVideosMeta("")
}

func (s *Service) listAllVideosByType(mediaType string) ([]domain.Video, error) {
	return s.store.ListAllVideos(mediaType)
}

type videoChanges struct {
	Added   int
	Removed int
	Updated int
}

// calculateVideoChanges compares scan fingerprints. Disk changes that the
// scanner treats as a rebuild (subtitles, NFO, poster, video file) are part of
// the fingerprint, so the scan log does not need to load subtitle rows.
func calculateVideoChanges(before []domain.Video, current []domain.Video) videoChanges {
	beforeFP := make(map[string]string, len(before))
	for _, video := range before {
		beforeFP[video.ID] = video.ScanFingerprint
	}

	currentFP := make(map[string]string, len(current))
	for _, video := range current {
		currentFP[video.ID] = video.ScanFingerprint
	}

	changes := videoChanges{}
	for id, currentSig := range currentFP {
		beforeSig, ok := beforeFP[id]
		if !ok {
			changes.Added++
			continue
		}
		// An empty fingerprint means the row has not been fingerprinted yet, or
		// fingerprinting failed. Do not treat filling it in as a content update.
		if strings.TrimSpace(beforeSig) == "" || strings.TrimSpace(currentSig) == "" {
			continue
		}
		if beforeSig != currentSig {
			changes.Updated++
		}
	}
	for id := range beforeFP {
		if _, ok := currentFP[id]; !ok {
			changes.Removed++
		}
	}
	return changes
}
