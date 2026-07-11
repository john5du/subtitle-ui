package app

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/sonarr"
)

// GetSeasonCompleteness compares local videos for a TV series season against Sonarr.
func (s *Service) GetSeasonCompleteness(ctx context.Context, path string, key string, season int) (domain.SeasonCompleteness, error) {
	out := domain.SeasonCompleteness{
		Season:  season,
		Missing: []domain.MissingEpisode{},
		Source:  "sonarr",
	}
	client := s.sonarrClient()
	if client == nil || !client.Enabled() {
		out.Enabled = false
		out.Message = "sonarr not configured"
		return out, nil
	}
	out.Enabled = true
	if season < 0 {
		return out, fmt.Errorf("%w: season required", ErrBadRequest)
	}

	meta, videos, err := s.resolveTVSeriesLocal(path, key)
	if err != nil {
		return out, err
	}
	if meta.Path == "" && meta.Key == "" {
		out.Message = "series not found"
		return out, nil
	}

	seriesList, err := client.ListSeries(ctx)
	if err != nil {
		out.Message = err.Error()
		return out, nil
	}
	matched, ok := sonarr.FindSeries(seriesList, meta.Path, meta.TmdbID, meta.ImdbID)
	if !ok {
		out.Matched = false
		out.Message = "series not found in sonarr"
		return out, nil
	}
	out.Matched = true
	out.SonarrSeriesID = matched.ID
	out.SeriesStatus = matched.Status

	episodes, err := client.ListEpisodes(ctx, matched.ID, season)
	if err != nil {
		out.Message = err.Error()
		return out, nil
	}

	now := time.Now().UTC()
	expected := make([]sonarr.Episode, 0, len(episodes))
	for _, ep := range episodes {
		if !ep.Monitored {
			continue
		}
		if !episodeHasAired(ep, now) {
			continue
		}
		expected = append(expected, ep)
	}
	out.ExpectedCount = len(expected)

	localEps := localEpisodeNumbers(videos, season)
	out.LocalCount = len(localEps)

	missing := make([]domain.MissingEpisode, 0)
	for _, ep := range expected {
		if _, have := localEps[ep.EpisodeNumber]; have {
			continue
		}
		missing = append(missing, domain.MissingEpisode{
			Episode:         ep.EpisodeNumber,
			SonarrEpisodeID: ep.ID,
			Title:           ep.Title,
			AirDate:         firstNonEmpty(ep.AirDate, ep.AirDateUTC),
		})
	}
	sort.Slice(missing, func(i, j int) bool { return missing[i].Episode < missing[j].Episode })
	out.Missing = missing
	if out.ExpectedCount == 0 {
		out.Complete = false
		if out.Message == "" {
			out.Message = "no aired monitored episodes for season"
		}
	} else {
		out.Complete = len(missing) == 0
	}
	return out, nil
}

// SearchSonarrMissing queues Sonarr EpisodeSearch for missing episodes in a season.
func (s *Service) SearchSonarrMissing(ctx context.Context, req domain.SonarrSearchRequest) (domain.SonarrSearchResult, error) {
	client := s.sonarrClient()
	if client == nil || !client.Enabled() {
		return domain.SonarrSearchResult{}, fmt.Errorf("%w: sonarr not configured", ErrProviderDisabled)
	}
	if req.Season < 0 {
		return domain.SonarrSearchResult{}, fmt.Errorf("%w: season required", ErrBadRequest)
	}

	completeness, err := s.GetSeasonCompleteness(ctx, req.Path, req.Key, req.Season)
	if err != nil {
		return domain.SonarrSearchResult{}, err
	}
	if !completeness.Enabled {
		return domain.SonarrSearchResult{}, fmt.Errorf("%w: sonarr not configured", ErrProviderDisabled)
	}
	if !completeness.Matched {
		return domain.SonarrSearchResult{}, fmt.Errorf("%w: series not found in sonarr", ErrNotFound)
	}

	allowed := make(map[int]domain.MissingEpisode, len(completeness.Missing))
	for _, m := range completeness.Missing {
		allowed[m.Episode] = m
	}

	var want []int
	if req.AllMissing {
		for _, m := range completeness.Missing {
			want = append(want, m.Episode)
		}
	} else {
		want = append(want, req.Episodes...)
	}
	if len(want) == 0 {
		return domain.SonarrSearchResult{}, fmt.Errorf("%w: no episodes to search", ErrBadRequest)
	}

	ids := make([]int, 0, len(want))
	seen := make(map[int]struct{}, len(want))
	for _, epNum := range want {
		m, ok := allowed[epNum]
		if !ok || m.SonarrEpisodeID <= 0 {
			return domain.SonarrSearchResult{}, fmt.Errorf("%w: episode %d is not a missing monitored episode", ErrBadRequest, epNum)
		}
		if _, dup := seen[m.SonarrEpisodeID]; dup {
			continue
		}
		seen[m.SonarrEpisodeID] = struct{}{}
		ids = append(ids, m.SonarrEpisodeID)
	}
	if len(ids) == 0 {
		return domain.SonarrSearchResult{}, fmt.Errorf("%w: no episode ids", ErrBadRequest)
	}

	cmd, err := client.EpisodeSearch(ctx, ids)
	if err != nil {
		s.recordOp("sonarr_search", systemOperationVideoID, "series:"+strconv.Itoa(completeness.SonarrSeriesID), "", "error", err.Error())
		return domain.SonarrSearchResult{}, err
	}

	msg := fmt.Sprintf("queued EpisodeSearch command=%d season=%d episodeIds=%v", cmd.ID, req.Season, ids)
	s.recordOp("sonarr_search", systemOperationVideoID, "series:"+strconv.Itoa(completeness.SonarrSeriesID), "", "ok", msg)

	return domain.SonarrSearchResult{
		Queued:     true,
		CommandID:  cmd.ID,
		EpisodeIDs: ids,
		Message:    "search queued in sonarr",
	}, nil
}

type tvSeriesLocalMeta struct {
	Key    string
	Path   string
	TmdbID string
	ImdbID string
	Title  string
}

func (s *Service) resolveTVSeriesLocal(path string, key string) (tvSeriesLocalMeta, []domain.Video, error) {
	videos, err := s.listAllTVVideos()
	if err != nil {
		return tvSeriesLocalMeta{}, nil, err
	}
	path = strings.TrimSpace(path)
	key = strings.TrimSpace(key)
	rows := buildTVSeriesSummaries(videos, s.cfg.TVMediaRoot)

	var summary *domain.TVSeriesSummary
	for i := range rows {
		row := &rows[i]
		if key != "" && strings.EqualFold(row.Key, key) {
			summary = row
			break
		}
		if path != "" && pathsEqualLoose(row.Path, path) {
			summary = row
			break
		}
	}
	if summary == nil {
		return tvSeriesLocalMeta{}, nil, nil
	}

	seriesVideos := make([]domain.Video, 0)
	for _, v := range videos {
		vk, seriesPath, _ := resolveTVSeriesFromVideo(v, s.cfg.TVMediaRoot)
		if summary.Key != "" && vk == summary.Key {
			seriesVideos = append(seriesVideos, v)
			continue
		}
		if pathsEqualLoose(seriesPath, summary.Path) {
			seriesVideos = append(seriesVideos, v)
		}
	}

	return tvSeriesLocalMeta{
		Key:    summary.Key,
		Path:   summary.Path,
		TmdbID: summary.TmdbID,
		ImdbID: summary.ImdbID,
		Title:  summary.Title,
	}, seriesVideos, nil
}

func localEpisodeNumbers(videos []domain.Video, season int) map[int]struct{} {
	out := make(map[int]struct{})
	for _, v := range videos {
		parsed := parseSeasonEpisodeNumbersWithDefault(strings.TrimSpace(v.FileName+" "+v.Title), season)
		if parsed == nil || parsed.Season != season {
			continue
		}
		out[parsed.Episode] = struct{}{}
	}
	return out
}

func episodeHasAired(ep sonarr.Episode, now time.Time) bool {
	if strings.TrimSpace(ep.AirDateUTC) != "" {
		if t, err := time.Parse(time.RFC3339, ep.AirDateUTC); err == nil {
			return !t.After(now)
		}
		if t, err := time.Parse("2006-01-02T15:04:05Z", ep.AirDateUTC); err == nil {
			return !t.After(now)
		}
	}
	if d := strings.TrimSpace(ep.AirDate); d != "" {
		if t, err := time.Parse("2006-01-02", d); err == nil {
			// Compare calendar date in UTC.
			today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
			return !t.After(today)
		}
	}
	// No air date: treat as not yet aired (exclude from missing).
	return false
}

func pathsEqualLoose(a, b string) bool {
	na := strings.ToLower(strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(a), "\\", "/"), "/"))
	nb := strings.ToLower(strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(b), "\\", "/"), "/"))
	return na != "" && na == nb
}

func (s *Service) sonarrClient() *sonarr.Client {
	s.sonarrMu.RLock()
	defer s.sonarrMu.RUnlock()
	return s.sonarr
}
