package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

func (s *Service) ConvertSubtitleToASS(videoID string, subtitleID string, options SubtitleConvertOptions) (domain.Subtitle, error) {
	return s.ConvertSubtitleToASSCtx(context.Background(), videoID, subtitleID, options)
}

func (s *Service) ConvertSubtitleToASSCtx(ctx context.Context, videoID string, subtitleID string, options SubtitleConvertOptions) (domain.Subtitle, error) {
	mu := s.lockVideo(videoID)
	mu.Lock()
	defer mu.Unlock()

	video, err := s.GetVideo(videoID)
	if err != nil {
		return domain.Subtitle{}, err
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return domain.Subtitle{}, ErrNotFound
	}
	if !strings.EqualFold(filepath.Ext(existing.Path), ".srt") {
		return domain.Subtitle{}, fmt.Errorf("%w: only srt subtitles can be converted to ass", ErrBadRequest)
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return domain.Subtitle{}, ErrUnsafePath
	}

	targetPath, err := s.convertSRTPathToASS(existing.Path, options.SourceEncoding)
	if err != nil {
		s.recordOpCtx(ctx, "convert", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, err
	}

	sourceOverrides := map[string]subtitleSourceOverride{
		subtitleSourceOverrideKey(targetPath): {
			Source:       domain.SubtitleSourceGenerated,
			SourceDetail: existing.FileName,
		},
	}
	updatedVideo, updatedSub, err := s.refreshVideoSubtitles(videoID, targetPath, sourceOverrides)
	if err != nil {
		s.recordOpCtx(ctx, "convert", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, err
	}

	s.recordOpExCtx(ctx, OpRecord{
		Action:     "convert",
		VideoID:    updatedVideo.ID,
		TargetPath: existing.Path,
		Status:     "ok",
		Message:    fmt.Sprintf("generated from %s", existing.FileName),
		Meta: map[string]any{
			"generatedPath": targetPath,
			"sourcePath":    existing.Path,
		},
	})

	s.notifyJellyfinAfterSubtitleChange(updatedVideo.ID)
	return updatedSub, nil
}

func (s *Service) convertSRTPathToASS(sourcePath string, sourceEncoding string) (string, error) {
	if !strings.EqualFold(filepath.Ext(sourcePath), ".srt") {
		return "", fmt.Errorf("%w: only srt subtitles can be converted to ass", ErrBadRequest)
	}
	if !s.isWithinMediaRoots(sourcePath) {
		return "", ErrUnsafePath
	}

	cfg, err := s.GetSubtitleConversionConfig()
	if err != nil {
		return "", err
	}
	encodingName := strings.TrimSpace(sourceEncoding)
	if encodingName == "" {
		encodingName = cfg.SourceEncodingDefault
	}
	if _, err := subtitle.NormalizeSourceEncoding(encodingName); err != nil {
		return "", fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	sourceData, err := os.ReadFile(sourcePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrNotFound
		}
		return "", err
	}
	assData, err := subtitle.ConvertSRTBytesToASS(sourceData, encodingName, cfg.ASSTemplate)
	if err != nil {
		return "", fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	targetPath, err := subtitle.BuildUniqueSiblingSubtitlePath(sourcePath, ".ass")
	if err != nil {
		return "", err
	}
	if !s.isWithinMediaRoots(targetPath) {
		return "", ErrUnsafePath
	}
	if err := subtitle.WriteFileBytes(assData, targetPath); err != nil {
		return "", err
	}
	return targetPath, nil
}

func (s *Service) OffsetSubtitleTiming(videoID string, subtitleID string, options SubtitleTimingOffsetOptions) (domain.Subtitle, error) {
	return s.OffsetSubtitleTimingCtx(context.Background(), videoID, subtitleID, options)
}

func (s *Service) OffsetSubtitleTimingCtx(ctx context.Context, videoID string, subtitleID string, options SubtitleTimingOffsetOptions) (domain.Subtitle, error) {
	offsetMS := options.OffsetMS
	if offsetMS == 0 {
		return domain.Subtitle{}, fmt.Errorf("%w: offsetMs must not be zero", ErrBadRequest)
	}
	if offsetMS < -subtitle.MaxTimingOffsetMilliseconds || offsetMS > subtitle.MaxTimingOffsetMilliseconds {
		return domain.Subtitle{}, fmt.Errorf("%w: offsetMs must be between -%d and %d", ErrBadRequest, subtitle.MaxTimingOffsetMilliseconds, subtitle.MaxTimingOffsetMilliseconds)
	}

	mu := s.lockVideo(videoID)
	mu.Lock()
	defer mu.Unlock()

	video, err := s.GetVideo(videoID)
	if err != nil {
		return domain.Subtitle{}, err
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return domain.Subtitle{}, ErrNotFound
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return domain.Subtitle{}, ErrUnsafePath
	}

	sourceData, err := os.ReadFile(existing.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return domain.Subtitle{}, ErrNotFound
		}
		return domain.Subtitle{}, err
	}
	shiftedData, err := subtitle.OffsetTimingBytes(sourceData, filepath.Ext(existing.Path), offsetMS)
	if err != nil {
		s.recordOpCtx(ctx, "offset", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	backupPath, err := subtitle.BackupFile(existing.Path)
	if err != nil {
		err = fmt.Errorf("backup before timing offset failed: %w", err)
		s.recordOpCtx(ctx, "offset", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, err
	}
	if err := subtitle.WriteFileBytes(shiftedData, existing.Path); err != nil {
		s.recordOpCtx(ctx, "offset", videoID, existing.Path, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}

	sourceOverrides := map[string]subtitleSourceOverride{
		subtitleSourceOverrideKey(existing.Path): {
			Source:       existing.Source,
			SourceDetail: existing.SourceDetail,
		},
	}
	updatedVideo, updatedSub, err := s.refreshVideoSubtitles(videoID, existing.Path, sourceOverrides)
	if err != nil {
		s.recordOpCtx(ctx, "offset", videoID, existing.Path, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}

	s.recordOpCtx(
		ctx,
		"offset",
		updatedVideo.ID,
		existing.Path,
		backupPath,
		"ok",
		fmt.Sprintf("offset_ms=%d", offsetMS),
	)

	s.notifyJellyfinAfterSubtitleChange(updatedVideo.ID)
	return updatedSub, nil
}

func (s *Service) DeleteSubtitle(videoID string, subtitleID string) error {
	return s.DeleteSubtitleCtx(context.Background(), videoID, subtitleID)
}

func (s *Service) DeleteSubtitleCtx(ctx context.Context, videoID string, subtitleID string) error {
	mu := s.lockVideo(videoID)
	mu.Lock()
	defer mu.Unlock()

	video, err := s.GetVideo(videoID)
	if err != nil {
		return err
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return ErrNotFound
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return ErrUnsafePath
	}

	backupPath, err := subtitle.BackupFile(existing.Path)
	if err != nil {
		err = fmt.Errorf("backup before delete failed: %w", err)
		s.recordOpCtx(ctx, "delete", videoID, existing.Path, "", "error", err.Error())
		return err
	}
	if err := os.Remove(existing.Path); err != nil {
		s.recordOpCtx(ctx, "delete", videoID, existing.Path, backupPath, "error", err.Error())
		return err
	}

	_, _, err = s.refreshVideoSubtitles(videoID, "", nil)
	if err != nil {
		s.recordOpCtx(ctx, "delete", videoID, existing.Path, backupPath, "error", err.Error())
		return err
	}

	s.recordOpCtx(ctx, "delete", videoID, existing.Path, backupPath, "ok", "")
	s.notifyJellyfinAfterSubtitleChange(videoID)
	return nil
}

func (s *Service) ReadSubtitleContent(videoID string, subtitleID string) ([]byte, error) {
	video, err := s.GetVideo(videoID)
	if err != nil {
		return nil, err
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return nil, ErrNotFound
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return nil, ErrUnsafePath
	}

	data, err := os.ReadFile(existing.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return data, nil
}
