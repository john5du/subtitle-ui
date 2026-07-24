package app

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/version"
)

func (s *Service) ListVideosPage(query string, mediaType string, directory string, page int, pageSize int, sortBy string, sortOrder string) domain.VideoPage {
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
		return domain.VideoPage{
			Items:      []domain.Video{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
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
	}
}

func (s *Service) VersionInfo() domain.VersionInfo {
	return domain.VersionInfo{
		Version:      version.Value,
		DatabaseType: s.store.DatabaseType(),
	}
}

func (s *Service) GetVideo(videoID string) (domain.Video, bool) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, false
	}
	return video, found
}

func (s *Service) listAllTVVideos() ([]domain.Video, error) {
	return s.listAllVideosByType(domain.MediaTypeTV)
}

func (s *Service) listAllVideos() ([]domain.Video, error) {
	return s.listAllVideosByType("")
}

func (s *Service) listAllVideosByType(mediaType string) ([]domain.Video, error) {
	return s.store.ListAllVideos(mediaType)
}

type videoChanges struct {
	Added   int
	Removed int
	Updated int
}

func calculateVideoChanges(before []domain.Video, current []domain.Video) videoChanges {
	beforeSignatures := make(map[string]string, len(before))
	for _, video := range before {
		beforeSignatures[video.ID] = videoContentSignature(video)
	}

	currentSignatures := make(map[string]string, len(current))
	for _, video := range current {
		currentSignatures[video.ID] = videoContentSignature(video)
	}

	changes := videoChanges{}
	for id, currentSig := range currentSignatures {
		beforeSig, ok := beforeSignatures[id]
		if !ok {
			changes.Added++
			continue
		}
		if beforeSig != currentSig {
			changes.Updated++
		}
	}
	for id := range beforeSignatures {
		if _, ok := currentSignatures[id]; !ok {
			changes.Removed++
		}
	}
	return changes
}

func videoContentSignature(video domain.Video) string {
	var b strings.Builder
	b.Grow(256)
	b.WriteString(strings.ToLower(strings.TrimSpace(video.Path)))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.Title))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.OriginalTitle))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.Year))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.ImdbID))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.TmdbID))
	b.WriteString("|")
	b.WriteString(strings.ToLower(strings.TrimSpace(video.MediaType)))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.MetadataSource))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesTitle))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesOriginalTitle))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesImdbID))
	b.WriteString("|")
	b.WriteString(strings.TrimSpace(video.SeriesTmdbID))
	b.WriteString("|")
	b.WriteString(strings.ToLower(strings.TrimSpace(video.PosterPath)))

	subs := append([]domain.Subtitle(nil), video.Subtitles...)
	sort.Slice(subs, func(i int, j int) bool {
		if !strings.EqualFold(subs[i].Path, subs[j].Path) {
			return strings.ToLower(subs[i].Path) < strings.ToLower(subs[j].Path)
		}
		return strings.ToLower(subs[i].FileName) < strings.ToLower(subs[j].FileName)
	})
	for _, sub := range subs {
		b.WriteString("|")
		b.WriteString(strings.ToLower(strings.TrimSpace(sub.Path)))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.FileName))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Language))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Format))
		b.WriteString(":")
		b.WriteString(strconv.FormatInt(sub.Size, 10))
		b.WriteString(":")
		b.WriteString(sub.ModTime.UTC().Format(time.RFC3339Nano))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.Source))
		b.WriteString(":")
		b.WriteString(strings.TrimSpace(sub.SourceDetail))
	}
	return b.String()
}
