package app

import (
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

type SubtitleUploadOptions struct {
	ConvertTo      string
	SourceEncoding string
}

type SubtitleConvertOptions struct {
	SourceEncoding string
}

type SubtitleTimingOffsetOptions struct {
	OffsetMS int
}

type subtitleSourceOverride struct {
	Source       string
	SourceDetail string
}

func (s *Service) UploadSubtitle(videoID string, file multipart.File, header *multipart.FileHeader, label string, replaceID string) (domain.Subtitle, error) {
	return s.UploadSubtitleWithOptions(videoID, file, header, label, replaceID, SubtitleUploadOptions{})
}

func (s *Service) UploadSubtitleWithOptions(videoID string, file multipart.File, header *multipart.FileHeader, label string, replaceID string, options SubtitleUploadOptions) (domain.Subtitle, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !subtitle.IsValidExtension(ext) {
		return domain.Subtitle{}, ErrInvalidFileType
	}

	convertTo := strings.ToLower(strings.TrimSpace(options.ConvertTo))
	shouldConvertToASS := convertTo == "ass"
	if convertTo != "" && !shouldConvertToASS {
		return domain.Subtitle{}, fmt.Errorf("%w: unsupported conversion target: %s", ErrBadRequest, options.ConvertTo)
	}
	if shouldConvertToASS && replaceID != "" {
		return domain.Subtitle{}, fmt.Errorf("%w: conversion is only supported for new srt uploads", ErrBadRequest)
	}
	if shouldConvertToASS && ext != ".srt" {
		return domain.Subtitle{}, fmt.Errorf("%w: only srt uploads can be converted to ass", ErrBadRequest)
	}

	var err error
	targetPath := ""
	backupPath := ""
	action := "upload"
	replaceSourcePath := ""

	if replaceID != "" {
		existing, found := findSubtitle(video.Subtitles, replaceID)
		if !found {
			return domain.Subtitle{}, ErrNotFound
		}
		if !s.isWithinMediaRoots(existing.Path) {
			return domain.Subtitle{}, ErrUnsafePath
		}
		replaceSourcePath = existing.Path
		backupPath, err = subtitle.BackupFile(existing.Path)
		if err != nil {
			return domain.Subtitle{}, fmt.Errorf("backup before replace failed: %w", err)
		}

		targetPath = subtitle.BuildReplacementSubtitlePath(existing.Path, ext)
		if !sameFilePath(targetPath, existing.Path) && subtitle.PathExists(targetPath) {
			return domain.Subtitle{}, fmt.Errorf("%w: subtitle path conflict: %s", ErrBadRequest, filepath.Base(targetPath))
		}
		action = "replace"
	} else {
		targetPath, err = subtitle.BuildNewSubtitlePath(video.Path, label, ext)
		if err != nil {
			return domain.Subtitle{}, err
		}
	}

	if !s.isWithinMediaRoots(targetPath) {
		return domain.Subtitle{}, ErrUnsafePath
	}
	if err := subtitle.WriteUploadedFile(file, targetPath); err != nil {
		return domain.Subtitle{}, err
	}
	if replaceSourcePath != "" && !sameFilePath(targetPath, replaceSourcePath) {
		if err := os.Remove(replaceSourcePath); err != nil {
			return domain.Subtitle{}, fmt.Errorf("cleanup replaced subtitle failed: %w", err)
		}
	}

	sourceOverrides := map[string]subtitleSourceOverride{
		subtitleSourceOverrideKey(targetPath): {
			Source:       domain.SubtitleSourceUpload,
			SourceDetail: subtitleSourceDetailFromUpload(header.Filename, targetPath),
		},
	}
	selectedTargetPath := targetPath
	convertedTargetPath := ""
	if shouldConvertToASS {
		convertedTargetPath, err = s.convertSRTPathToASS(targetPath, options.SourceEncoding)
		if err != nil {
			_, _, _ = s.refreshVideoSubtitles(videoID, targetPath, sourceOverrides)
			_ = s.store.AppendLog(domain.OperationLog{
				ID:         makeID(fmt.Sprintf("convert-error-%s-%d", targetPath, time.Now().UnixNano())),
				Timestamp:  time.Now().UTC(),
				Action:     "convert",
				VideoID:    videoID,
				TargetPath: targetPath,
				Status:     "error",
				Message:    err.Error(),
			})
			return domain.Subtitle{}, err
		}
		sourceOverrides[subtitleSourceOverrideKey(convertedTargetPath)] = subtitleSourceOverride{
			Source:       domain.SubtitleSourceGenerated,
			SourceDetail: filepath.Base(targetPath),
		}
		selectedTargetPath = convertedTargetPath
	}

	updatedVideo, updatedSub, err := s.refreshVideoSubtitles(videoID, selectedTargetPath, sourceOverrides)
	if err != nil {
		return domain.Subtitle{}, err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("%s-%s-%d", action, targetPath, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     action,
		VideoID:    updatedVideo.ID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     "ok",
	})

	if convertedTargetPath != "" {
		_ = s.store.AppendLog(domain.OperationLog{
			ID:         makeID(fmt.Sprintf("convert-%s-%d", convertedTargetPath, time.Now().UnixNano())),
			Timestamp:  time.Now().UTC(),
			Action:     "convert",
			VideoID:    updatedVideo.ID,
			TargetPath: convertedTargetPath,
			Status:     "ok",
			Message:    fmt.Sprintf("generated from %s", filepath.Base(targetPath)),
		})
	}

	return updatedSub, nil
}

func (s *Service) ConvertSubtitleToASS(videoID string, subtitleID string, options SubtitleConvertOptions) (domain.Subtitle, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
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
		_ = s.store.AppendLog(domain.OperationLog{
			ID:         makeID(fmt.Sprintf("convert-error-%s-%d", existing.Path, time.Now().UnixNano())),
			Timestamp:  time.Now().UTC(),
			Action:     "convert",
			VideoID:    videoID,
			TargetPath: existing.Path,
			Status:     "error",
			Message:    err.Error(),
		})
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
		return domain.Subtitle{}, err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("convert-%s-%d", targetPath, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     "convert",
		VideoID:    updatedVideo.ID,
		TargetPath: targetPath,
		Status:     "ok",
		Message:    fmt.Sprintf("generated from %s", existing.FileName),
	})

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
	offsetMS := options.OffsetMS
	if offsetMS == 0 {
		return domain.Subtitle{}, fmt.Errorf("%w: offsetMs must not be zero", ErrBadRequest)
	}
	if offsetMS < -subtitle.MaxTimingOffsetMilliseconds || offsetMS > subtitle.MaxTimingOffsetMilliseconds {
		return domain.Subtitle{}, fmt.Errorf("%w: offsetMs must be between -%d and %d", ErrBadRequest, subtitle.MaxTimingOffsetMilliseconds, subtitle.MaxTimingOffsetMilliseconds)
	}

	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
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
		_ = s.store.AppendLog(domain.OperationLog{
			ID:         makeID(fmt.Sprintf("offset-error-%s-%d", existing.Path, time.Now().UnixNano())),
			Timestamp:  time.Now().UTC(),
			Action:     "offset",
			VideoID:    videoID,
			TargetPath: existing.Path,
			Status:     "error",
			Message:    err.Error(),
		})
		return domain.Subtitle{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	backupPath, err := subtitle.BackupFile(existing.Path)
	if err != nil {
		return domain.Subtitle{}, fmt.Errorf("backup before timing offset failed: %w", err)
	}
	if err := subtitle.WriteFileBytes(shiftedData, existing.Path); err != nil {
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
		return domain.Subtitle{}, err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("offset-%s-%d", existing.Path, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     "offset",
		VideoID:    updatedVideo.ID,
		TargetPath: existing.Path,
		BackupPath: backupPath,
		Status:     "ok",
		Message:    fmt.Sprintf("offset_ms=%d", offsetMS),
	})

	return updatedSub, nil
}

func (s *Service) DeleteSubtitle(videoID string, subtitleID string) error {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return ErrNotFound
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
		return fmt.Errorf("backup before delete failed: %w", err)
	}
	if err := os.Remove(existing.Path); err != nil {
		return err
	}

	_, _, err = s.refreshVideoSubtitles(videoID, "", nil)
	if err != nil {
		return err
	}

	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(fmt.Sprintf("delete-%s-%d", existing.Path, time.Now().UnixNano())),
		Timestamp:  time.Now().UTC(),
		Action:     "delete",
		VideoID:    videoID,
		TargetPath: existing.Path,
		BackupPath: backupPath,
		Status:     "ok",
	})
	return nil
}

func (s *Service) ReadSubtitleContent(videoID string, subtitleID string) ([]byte, error) {
	video, ok := s.GetVideo(videoID)
	if !ok {
		return nil, ErrNotFound
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

func (s *Service) refreshVideoSubtitles(videoID string, targetPath string, sourceOverrides map[string]subtitleSourceOverride) (domain.Video, domain.Subtitle, error) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}
	if !found {
		return domain.Video{}, domain.Subtitle{}, ErrNotFound
	}

	subs, err := s.scanner.ScanSubtitlesForVideo(video.Path)
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}
	applySubtitleSourceOverrides(subs, sourceOverrides)

	updatedAt := time.Now().UTC()
	err = s.store.UpdateVideoSubtitles(videoID, subs, updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Video{}, domain.Subtitle{}, ErrNotFound
	}
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}

	updatedVideo, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, domain.Subtitle{}, err
	}
	if !found {
		return domain.Video{}, domain.Subtitle{}, ErrNotFound
	}

	if targetPath == "" {
		return updatedVideo, domain.Subtitle{}, nil
	}
	for _, sub := range updatedVideo.Subtitles {
		if strings.EqualFold(sub.Path, targetPath) {
			return updatedVideo, sub, nil
		}
	}
	return domain.Video{}, domain.Subtitle{}, ErrNotFound
}

func applySubtitleSourceOverrides(subtitles []domain.Subtitle, overrides map[string]subtitleSourceOverride) {
	if len(overrides) == 0 {
		return
	}
	for i := range subtitles {
		override, ok := overrides[subtitleSourceOverrideKey(subtitles[i].Path)]
		if !ok {
			continue
		}
		subtitles[i].Source = override.Source
		subtitles[i].SourceDetail = strings.TrimSpace(override.SourceDetail)
	}
}

func subtitleSourceOverrideKey(pathValue string) string {
	normalized := filepath.Clean(strings.TrimSpace(pathValue))
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	return strings.ToLower(normalized)
}

func subtitleSourceDetailFromUpload(uploadName string, targetPath string) string {
	cleanUploadName := strings.ReplaceAll(strings.TrimSpace(uploadName), "\\", "/")
	detail := strings.TrimSpace(filepath.Base(cleanUploadName))
	if detail != "" && detail != "." {
		return detail
	}
	return filepath.Base(targetPath)
}

func findSubtitle(subtitles []domain.Subtitle, subtitleID string) (domain.Subtitle, bool) {
	for _, sub := range subtitles {
		if sub.ID == subtitleID {
			return sub, true
		}
	}
	return domain.Subtitle{}, false
}

func makeID(s string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToLower(s)))
	return strings.ToUpper(formatUintHex(h.Sum64()))
}

func formatUintHex(v uint64) string {
	const alphabet = "0123456789ABCDEF"
	if v == 0 {
		return "0"
	}
	var out [16]byte
	pos := len(out)
	for v > 0 {
		pos--
		out[pos] = alphabet[v&0x0F]
		v >>= 4
	}
	return string(out[pos:])
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (s *Service) isWithinMediaRoots(targetPath string) bool {
	if subtitle.EnsureWithinRoot(s.cfg.MovieMediaRoot, targetPath) {
		return true
	}
	return subtitle.EnsureWithinRoot(s.cfg.TVMediaRoot, targetPath)
}
