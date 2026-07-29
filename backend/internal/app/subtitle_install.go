package app

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/archive"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

type SubtitleUploadOptions struct {
	ConvertTo      string
	SourceEncoding string
	ArchiveEntry   string
}

// ArchiveBatchMapping installs one archive entry onto a video.
type ArchiveBatchMapping struct {
	VideoID        string `json:"videoId"`
	ArchiveEntry   string `json:"archiveEntry"`
	Label          string `json:"label,omitempty"`
	ConvertTo      string `json:"convertTo,omitempty"`
	SourceEncoding string `json:"sourceEncoding,omitempty"`
}

// ArchiveBatchItemResult is one item from BatchUploadFromArchive.
type ArchiveBatchItemResult struct {
	VideoID      string           `json:"videoId"`
	ArchiveEntry string           `json:"archiveEntry"`
	OK           bool             `json:"ok"`
	Subtitle     *domain.Subtitle `json:"subtitle,omitempty"`
	Error        string           `json:"error,omitempty"`
}

// ArchiveBatchResult is the batch install response.
type ArchiveBatchResult struct {
	Results []ArchiveBatchItemResult `json:"results"`
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

// InstallSubtitleFromPath installs a subtitle file from a path under media roots (MCP / agent friendly).
func (s *Service) InstallSubtitleFromPath(videoID string, filePath string, label string, replaceID string, options SubtitleUploadOptions) (domain.Subtitle, error) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return domain.Subtitle{}, fmt.Errorf("%w: missing path", ErrBadRequest)
	}
	abs, err := filepath.Abs(filePath)
	if err != nil {
		return domain.Subtitle{}, fmt.Errorf("%w: invalid path", ErrBadRequest)
	}
	if !s.isWithinMediaRoots(abs) {
		return domain.Subtitle{}, ErrUnsafePath
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return domain.Subtitle{}, fmt.Errorf("%w: file not found", ErrNotFound)
		}
		return domain.Subtitle{}, err
	}
	if info.IsDir() {
		return domain.Subtitle{}, fmt.Errorf("%w: path is a directory", ErrBadRequest)
	}
	if info.Size() > 64<<20 {
		return domain.Subtitle{}, fmt.Errorf("%w: file too large", ErrBadRequest)
	}
	payload, err := os.ReadFile(abs)
	if err != nil {
		return domain.Subtitle{}, err
	}
	return s.installSubtitleBytes(videoID, payload, filepath.Base(abs), label, replaceID, options)
}

func (s *Service) UploadSubtitleWithOptions(videoID string, file multipart.File, header *multipart.FileHeader, label string, replaceID string, options SubtitleUploadOptions) (domain.Subtitle, error) {
	payload, err := io.ReadAll(io.LimitReader(file, 64<<20+1))
	if err != nil {
		return domain.Subtitle{}, err
	}
	if len(payload) > 64<<20 {
		return domain.Subtitle{}, fmt.Errorf("%w: file too large", ErrBadRequest)
	}
	uploadName := ""
	if header != nil {
		uploadName = header.Filename
	}
	return s.installSubtitleBytes(videoID, payload, uploadName, label, replaceID, options)
}

func readUploadPayload(file multipart.File, header *multipart.FileHeader) ([]byte, string, error) {
	if file == nil {
		return nil, "", fmt.Errorf("%w: missing file", ErrBadRequest)
	}
	payload, err := io.ReadAll(io.LimitReader(file, 64<<20+1))
	if err != nil {
		return nil, "", err
	}
	if len(payload) > 64<<20 {
		return nil, "", fmt.Errorf("%w: file too large", ErrBadRequest)
	}
	name := "upload.bin"
	if header != nil && strings.TrimSpace(header.Filename) != "" {
		name = header.Filename
	}
	return payload, name, nil
}

func lookupExtractedEntry(extracted map[string][]byte, preferred string) ([]byte, bool) {
	preferred = strings.TrimSpace(preferred)
	if preferred == "" {
		return nil, false
	}
	if data, ok := extracted[preferred]; ok {
		return data, true
	}
	normPreferred := strings.TrimPrefix(strings.ReplaceAll(preferred, "\\", "/"), "/")
	if data, ok := extracted[normPreferred]; ok {
		return data, true
	}
	base := path.Base(normPreferred)
	for key, data := range extracted {
		if key == preferred || path.Base(key) == base || key == normPreferred {
			return data, true
		}
	}
	return nil, false
}

func mapArchiveError(err error) error {
	if err == nil {
		return nil
	}
	var multi *archive.MultipleEntriesError
	if errors.As(err, &multi) {
		return &ArchiveMultipleEntriesError{Entries: multi.Entries}
	}
	switch {
	case errors.Is(err, archive.ErrNoSubtitle):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, archive.ErrUnsupported), errors.Is(err, archive.ErrNotArchive), errors.Is(err, archive.ErrEntryNotFound):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	case errors.Is(err, archive.ErrInvalidArchive), errors.Is(err, archive.ErrReadFailed):
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	default:
		return err
	}
}

// ArchiveMultipleEntriesError is returned when an archive needs an explicit entry pick.
type ArchiveMultipleEntriesError struct {
	Entries []archive.Entry
}

func (e *ArchiveMultipleEntriesError) Error() string {
	if e == nil || len(e.Entries) == 0 {
		return archive.ErrMultipleEntries.Error()
	}
	names := make([]string, 0, len(e.Entries))
	for _, ent := range e.Entries {
		names = append(names, ent.Path)
	}
	return fmt.Sprintf("%s: %s", archive.ErrMultipleEntries.Error(), strings.Join(names, ", "))
}

func (e *ArchiveMultipleEntriesError) Unwrap() error {
	return ErrBadRequest
}

func (s *Service) installSubtitleBytes(videoID string, payload []byte, uploadName string, label string, replaceID string, options SubtitleUploadOptions) (domain.Subtitle, error) {
	mu := s.lockVideo(videoID)
	mu.Lock()
	defer mu.Unlock()

	video, ok := s.GetVideo(videoID)
	if !ok {
		return domain.Subtitle{}, ErrNotFound
	}

	content := payload
	sourceName := uploadName
	archiveEntry := strings.TrimSpace(options.ArchiveEntry)
	if archive.IsArchive(payload, uploadName) || archiveEntry != "" {
		if !archive.IsArchive(payload, uploadName) {
			return domain.Subtitle{}, fmt.Errorf("%w: archiveEntry requires an archive upload", ErrBadRequest)
		}
		entryName, data, err := archive.ExtractSubtitle(payload, uploadName, archiveEntry)
		if err != nil {
			return domain.Subtitle{}, mapArchiveError(err)
		}
		content = data
		sourceName = uploadName + "/" + entryName
		uploadName = entryName
	}

	ext := strings.ToLower(filepath.Ext(uploadName))
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

	label = subtitle.DetectSubtitleLanguageLabel(subtitle.DetectLanguageOptions{
		ExplicitLabel: label,
		NameHints:     []string{uploadName, sourceName},
		Content:       content,
		Format:        ext,
		DefaultLabel:  "zh",
	})

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
			err = fmt.Errorf("backup before replace failed: %w", err)
			s.recordOp("replace", videoID, existing.Path, "", "error", err.Error())
			return domain.Subtitle{}, err
		}

		// Keep basename on replace, unless existing language is mono and new content is bilingual.
		targetPath = subtitle.BuildReplacementSubtitlePath(existing.Path, ext)
		if !subtitle.IsBilingualLanguage(existing.Language) && subtitle.IsBilingualLanguage(label) {
			if relabeled, relabelErr := subtitle.BuildNewSubtitlePath(video.Path, label, ext); relabelErr == nil {
				targetPath = relabeled
			}
		}
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
	if err := subtitle.WriteFileBytes(content, targetPath); err != nil {
		s.recordOp(action, videoID, targetPath, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}
	if replaceSourcePath != "" && !sameFilePath(targetPath, replaceSourcePath) {
		if err := os.Remove(replaceSourcePath); err != nil {
			err = fmt.Errorf("cleanup replaced subtitle failed: %w", err)
			s.recordOp(action, videoID, targetPath, backupPath, "error", err.Error())
			return domain.Subtitle{}, err
		}
	}

	sourceOverrides := map[string]subtitleSourceOverride{
		subtitleSourceOverrideKey(targetPath): {
			Source:       domain.SubtitleSourceUpload,
			SourceDetail: subtitleSourceDetailFromUpload(sourceName, targetPath),
		},
	}
	selectedTargetPath := targetPath
	convertedTargetPath := ""
	if shouldConvertToASS {
		convertedTargetPath, err = s.convertSRTPathToASS(targetPath, options.SourceEncoding)
		if err != nil {
			_, _, _ = s.refreshVideoSubtitles(videoID, targetPath, sourceOverrides)
			s.recordOp("convert", videoID, targetPath, "", "error", err.Error())
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
		s.recordOp(action, videoID, targetPath, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}

	s.recordOp(action, updatedVideo.ID, targetPath, backupPath, "ok", "")

	if convertedTargetPath != "" {
		s.recordOp(
			"convert",
			updatedVideo.ID,
			convertedTargetPath,
			"",
			"ok",
			fmt.Sprintf("generated from %s", filepath.Base(targetPath)),
		)
	}

	s.notifyJellyfinAfterSubtitleChange(updatedVideo.ID)
	return updatedSub, nil
}
