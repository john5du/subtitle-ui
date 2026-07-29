package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

// PlanNormalizeVideoSubtitles previews Jellyfin-style renames for one video.
func (s *Service) PlanNormalizeVideoSubtitles(videoID string) (domain.SubtitleNormalizePlan, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.SubtitleNormalizePlan{}, ErrNotFound
	}
	return domain.SubtitleNormalizePlan{Items: s.planNormalizeForVideo(video)}, nil
}

// PlanNormalizeSeasonSubtitles previews renames for all episodes in a TV season.
func (s *Service) PlanNormalizeSeasonSubtitles(path string, key string, season int) (domain.SubtitleNormalizePlan, error) {
	videos, err := s.listSeasonVideos(path, key, season)
	if err != nil {
		return domain.SubtitleNormalizePlan{}, err
	}
	items := make([]domain.SubtitleNormalizeItem, 0, 64)
	for _, video := range videos {
		items = append(items, s.planNormalizeForVideo(video)...)
	}
	return domain.SubtitleNormalizePlan{Items: items}, nil
}

// ApplyNormalizeVideoSubtitles applies selected renames for one video.
func (s *Service) ApplyNormalizeVideoSubtitles(videoID string, items []domain.SubtitleNormalizeApplyItem) (domain.SubtitleNormalizeApplyResult, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.SubtitleNormalizeApplyResult{}, ErrNotFound
	}
	filtered := make([]domain.SubtitleNormalizeApplyItem, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.VideoID) != "" && item.VideoID != videoID {
			continue
		}
		filtered = append(filtered, domain.SubtitleNormalizeApplyItem{
			VideoID:    videoID,
			SubtitleID: item.SubtitleID,
			ToPath:     item.ToPath,
		})
	}
	return s.applyNormalizeItems([]domain.Video{video}, filtered), nil
}

// ApplyNormalizeSeasonSubtitles applies selected renames across a TV season.
func (s *Service) ApplyNormalizeSeasonSubtitles(path string, key string, season int, items []domain.SubtitleNormalizeApplyItem) (domain.SubtitleNormalizeApplyResult, error) {
	videos, err := s.listSeasonVideos(path, key, season)
	if err != nil {
		return domain.SubtitleNormalizeApplyResult{}, err
	}
	return s.applyNormalizeItems(videos, items), nil
}

func (s *Service) listSeasonVideos(path string, key string, season int) ([]domain.Video, error) {
	if season < 0 {
		return nil, fmt.Errorf("%w: season required", ErrBadRequest)
	}
	_, videos, err := s.resolveTVSeriesLocal(path, key)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Video, 0, len(videos))
	for _, video := range videos {
		parsed := parseSeasonEpisodeNumbersWithDefault(strings.TrimSpace(video.FileName+" "+video.Title), season)
		if parsed == nil || parsed.Season != season {
			continue
		}
		out = append(out, video)
	}
	return out, nil
}

func (s *Service) planNormalizeForVideo(video domain.Video) []domain.SubtitleNormalizeItem {
	items := make([]domain.SubtitleNormalizeItem, 0, len(video.Subtitles))
	claimed := make(map[string]string, len(video.Subtitles))

	for _, sub := range video.Subtitles {
		item := buildNormalizePlanItem(video, sub)
		key := normalizePathKey(item.ToPath)
		if item.Status == domain.SubtitleNormalizeRename {
			if owner, taken := claimed[key]; taken && owner != sub.ID {
				item.Status = domain.SubtitleNormalizeSkipConflict
				item.Reason = "target claimed by another planned rename"
			} else if subtitle.PathExists(item.ToPath) && !strings.EqualFold(item.FromPath, item.ToPath) {
				item.Status = domain.SubtitleNormalizeSkipConflict
				item.Reason = "target already exists"
			} else {
				claimed[key] = sub.ID
			}
		}
		items = append(items, item)
	}
	return items
}

func buildNormalizePlanItem(video domain.Video, sub domain.Subtitle) domain.SubtitleNormalizeItem {
	fromPath := filepath.Clean(sub.Path)
	fromLanguage := strings.TrimSpace(sub.Language)
	fromFileName := filepath.Base(fromPath)
	pathLabel := subtitle.InferLabelFromSubtitlePath(video.Path, fromPath)

	// Canonicalize stored/path language first (zh-en → zh&en, chs → zh).
	labelSource := fromLanguage
	if labelSource == "" || strings.EqualFold(labelSource, "und") {
		labelSource = pathLabel
	}
	baseLabel := subtitle.NormalizeLanguageLabel(labelSource)
	if baseLabel == "" && pathLabel != "" {
		baseLabel = subtitle.NormalizeLanguageLabel(pathLabel)
	}

	// Always re-detect with filename + light content sample so bilingual tracks
	// mislabeled as zh/en/und are upgraded during normalize.
	var content []byte
	if data, err := os.ReadFile(fromPath); err == nil {
		content = data
	}
	detected := subtitle.DetectSubtitleLanguageLabel(subtitle.DetectLanguageOptions{
		ExplicitLabel: "",
		NameHints:     []string{fromFileName, sub.FileName, fromLanguage, pathLabel, labelSource},
		Content:       content,
		Format:        sub.Format,
		DefaultLabel:  baseLabel,
	})

	toLabel := chooseNormalizeTargetLabel(baseLabel, detected)

	ext := filepath.Ext(fromPath)
	if ext == "" && sub.Format != "" {
		ext = "." + strings.TrimPrefix(sub.Format, ".")
	}
	toPath := subtitle.BuildCanonicalSubtitlePath(video.Path, toLabel, ext)

	item := domain.SubtitleNormalizeItem{
		VideoID:      video.ID,
		SubtitleID:   sub.ID,
		FromPath:     fromPath,
		FromFileName: fromFileName,
		ToPath:       toPath,
		ToFileName:   filepath.Base(toPath),
		FromLanguage: fromLanguage,
		ToLabel:      toLabel,
		Status:       domain.SubtitleNormalizeRename,
	}

	if strings.EqualFold(fromPath, toPath) {
		item.Status = domain.SubtitleNormalizeNoop
		item.Reason = "already canonical"
		return item
	}
	if subtitle.IsBilingualLanguage(toLabel) && !subtitle.IsBilingualLanguage(fromLanguage) &&
		!strings.EqualFold(subtitle.NormalizeLanguageLabel(fromLanguage), toLabel) {
		item.Reason = "bilingual detected"
	}
	return item
}

// chooseNormalizeTargetLabel prefers bilingual detection, then filled labels over empty.
func chooseNormalizeTargetLabel(baseLabel, detected string) string {
	baseLabel = strings.TrimSpace(baseLabel)
	detected = strings.TrimSpace(detected)
	switch {
	case detected == "" && baseLabel == "":
		return ""
	case detected == "":
		return baseLabel
	case baseLabel == "":
		return detected
	case subtitle.IsBilingualLanguage(detected) && !subtitle.IsBilingualLanguage(baseLabel):
		return detected
	case subtitle.IsBilingualLanguage(baseLabel):
		// Keep canonical bilingual form (zh-en already normalized in baseLabel).
		return baseLabel
	case detected != baseLabel && subtitle.IsBilingualLanguage(detected):
		return detected
	default:
		// Prefer base (from stored language / path) for mono stability;
		// still allow traditional upgrade from content (zh → zh-hant).
		if baseLabel == "zh" && detected == "zh-hant" {
			return detected
		}
		return baseLabel
	}
}

func (s *Service) applyNormalizeItems(videos []domain.Video, items []domain.SubtitleNormalizeApplyItem) domain.SubtitleNormalizeApplyResult {
	videoByID := make(map[string]domain.Video, len(videos))
	for _, video := range videos {
		videoByID[video.ID] = video
	}

	result := domain.SubtitleNormalizeApplyResult{
		Results: make([]domain.SubtitleNormalizeApplyItemResult, 0, len(items)),
	}
	if len(items) == 0 {
		return result
	}

	// Group by video for a single refresh after renames.
	type pendingRename struct {
		item       domain.SubtitleNormalizeApplyItem
		from       domain.Subtitle
		toPath     string
		backupPath string
	}
	pendingByVideo := make(map[string][]pendingRename, len(videos))
	claimedTargets := make(map[string]struct{}, len(items))

	for _, item := range items {
		videoID := strings.TrimSpace(item.VideoID)
		subtitleID := strings.TrimSpace(item.SubtitleID)
		toPath := filepath.Clean(strings.TrimSpace(item.ToPath))
		out := domain.SubtitleNormalizeApplyItemResult{
			VideoID:    videoID,
			SubtitleID: subtitleID,
			ToPath:     toPath,
			Status:     domain.SubtitleNormalizeApplyFailed,
		}
		if videoID == "" || subtitleID == "" || toPath == "" {
			out.Error = "missing videoId, subtitleId, or toPath"
			result.Failed++
			result.Results = append(result.Results, out)
			continue
		}
		video, ok := videoByID[videoID]
		if !ok {
			// Refresh video map from store in case caller only passed ids.
			if loaded, found := s.GetVideo(videoID); found {
				video = loaded
				videoByID[videoID] = loaded
				ok = true
			}
		}
		if !ok {
			out.Error = "video not found"
			result.Failed++
			result.Results = append(result.Results, out)
			continue
		}
		existing, found := findSubtitle(video.Subtitles, subtitleID)
		if !found {
			out.Error = "subtitle not found"
			result.Failed++
			result.Results = append(result.Results, out)
			continue
		}
		out.FromPath = existing.Path
		out.FromFileName = existing.FileName
		out.ToFileName = filepath.Base(toPath)

		if !s.isWithinMediaRoots(existing.Path) || !s.isWithinMediaRoots(toPath) {
			out.Error = "path outside media roots"
			result.Failed++
			result.Results = append(result.Results, out)
			continue
		}
		if filepath.Dir(filepath.Clean(existing.Path)) != filepath.Dir(toPath) {
			out.Error = "rename must stay in the same directory"
			result.Failed++
			result.Results = append(result.Results, out)
			continue
		}

		// Recompute expected canonical path and only allow that target.
		planned := buildNormalizePlanItem(video, existing)
		if !strings.EqualFold(planned.ToPath, toPath) {
			out.Error = "toPath does not match canonical target"
			result.Failed++
			result.Results = append(result.Results, out)
			continue
		}
		if planned.Status == domain.SubtitleNormalizeNoop || strings.EqualFold(existing.Path, toPath) {
			out.Status = domain.SubtitleNormalizeApplySkipped
			out.Error = "already canonical"
			result.Skipped++
			result.Results = append(result.Results, out)
			continue
		}
		targetKey := normalizePathKey(toPath)
		if _, taken := claimedTargets[targetKey]; taken {
			out.Status = domain.SubtitleNormalizeApplySkipped
			out.Error = "target claimed by another rename in this batch"
			result.Skipped++
			result.Results = append(result.Results, out)
			continue
		}
		if subtitle.PathExists(toPath) && !strings.EqualFold(existing.Path, toPath) {
			out.Status = domain.SubtitleNormalizeApplySkipped
			out.Error = "target already exists"
			result.Skipped++
			result.Results = append(result.Results, out)
			continue
		}

		mu := s.lockVideo(videoID)
		mu.Lock()
		backupPath, err := subtitle.BackupFile(existing.Path)
		if err != nil {
			mu.Unlock()
			out.Error = fmt.Sprintf("backup failed: %v", err)
			result.Failed++
			result.Results = append(result.Results, out)
			s.recordOp("normalize", videoID, existing.Path, "", "error", out.Error)
			continue
		}
		if err := os.Rename(existing.Path, toPath); err != nil {
			mu.Unlock()
			out.Error = fmt.Sprintf("rename failed: %v", err)
			out.BackupPath = backupPath
			result.Failed++
			result.Results = append(result.Results, out)
			s.recordOp("normalize", videoID, existing.Path, backupPath, "error", out.Error)
			continue
		}
		mu.Unlock()

		claimedTargets[targetKey] = struct{}{}
		pendingByVideo[videoID] = append(pendingByVideo[videoID], pendingRename{
			item:       item,
			from:       existing,
			toPath:     toPath,
			backupPath: backupPath,
		})
		out.Status = domain.SubtitleNormalizeApplyOK
		out.BackupPath = backupPath
		result.Renamed++
		result.Results = append(result.Results, out)
		s.recordOpEx(OpRecord{
			Action:     "normalize",
			VideoID:    videoID,
			TargetPath: toPath,
			BackupPath: backupPath,
			Status:     "ok",
			Message:    fmt.Sprintf("from=%s to=%s", filepath.Base(existing.Path), filepath.Base(toPath)),
			Meta: map[string]any{
				"fromPath": existing.Path,
				"toPath":   toPath,
			},
		})
	}

	for videoID, pending := range pendingByVideo {
		overrides := make(map[string]subtitleSourceOverride, len(pending))
		for _, item := range pending {
			overrides[subtitleSourceOverrideKey(item.toPath)] = subtitleSourceOverride{
				Source:       item.from.Source,
				SourceDetail: item.from.SourceDetail,
			}
		}
		mu := s.lockVideo(videoID)
		mu.Lock()
		_, _, refreshErr := s.refreshVideoSubtitles(videoID, "", overrides)
		mu.Unlock()
		if refreshErr != nil {
			s.recordOp("normalize", videoID, "", "", "error", "refresh after rename: "+refreshErr.Error())
		} else {
			s.notifyJellyfinAfterSubtitleChange(videoID)
		}
		// Keep in-memory map fresh for later items in multi-video batches.
		if loaded, found := s.GetVideo(videoID); found {
			videoByID[videoID] = loaded
		}
	}

	return result
}

func normalizePathKey(pathValue string) string {
	normalized := filepath.Clean(strings.TrimSpace(pathValue))
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	return strings.ToLower(normalized)
}
