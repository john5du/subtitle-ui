package app

import (
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"mime/multipart"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

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

func (s *Service) ListArchiveSubtitleEntries(file multipart.File, header *multipart.FileHeader) ([]archive.Entry, error) {
	payload, name, err := readUploadPayload(file, header)
	if err != nil {
		return nil, err
	}
	entries, err := archive.ListSubtitleEntries(payload, name)
	if err != nil {
		return nil, mapArchiveError(err)
	}
	return entries, nil
}

func (s *Service) ExtractArchiveSubtitle(file multipart.File, header *multipart.FileHeader, entryPath string) (fileName string, data []byte, err error) {
	payload, name, err := readUploadPayload(file, header)
	if err != nil {
		return "", nil, err
	}
	entryPath = strings.TrimSpace(entryPath)
	if entryPath == "" {
		return "", nil, fmt.Errorf("%w: missing archive entry", ErrBadRequest)
	}
	fileName, data, err = archive.ExtractSubtitle(payload, name, entryPath)
	if err != nil {
		return "", nil, mapArchiveError(err)
	}
	return fileName, data, nil
}

func (s *Service) BatchUploadFromArchive(file multipart.File, header *multipart.FileHeader, mappings []ArchiveBatchMapping) (ArchiveBatchResult, error) {
	payload, name, err := readUploadPayload(file, header)
	if err != nil {
		return ArchiveBatchResult{}, err
	}
	if len(mappings) == 0 {
		return ArchiveBatchResult{}, fmt.Errorf("%w: empty mappings", ErrBadRequest)
	}
	extracted, err := archive.ExtractAllSubtitles(payload, name)
	if err != nil {
		return ArchiveBatchResult{}, mapArchiveError(err)
	}

	results := make([]ArchiveBatchItemResult, 0, len(mappings))
	for _, m := range mappings {
		item := ArchiveBatchItemResult{
			VideoID:      strings.TrimSpace(m.VideoID),
			ArchiveEntry: strings.TrimSpace(m.ArchiveEntry),
		}
		if item.VideoID == "" || item.ArchiveEntry == "" {
			item.Error = "missing videoId or archiveEntry"
			results = append(results, item)
			continue
		}
		data, ok := lookupExtractedEntry(extracted, item.ArchiveEntry)
		if !ok {
			item.Error = fmt.Sprintf("archive entry not found: %s", item.ArchiveEntry)
			results = append(results, item)
			continue
		}
		entryBase := path.Base(strings.ReplaceAll(item.ArchiveEntry, "\\", "/"))
		uploadName := name + "/" + entryBase
		sub, installErr := s.installSubtitleBytes(item.VideoID, data, uploadName, m.Label, "", SubtitleUploadOptions{
			ConvertTo:      m.ConvertTo,
			SourceEncoding: m.SourceEncoding,
		})
		if installErr != nil {
			item.Error = installErr.Error()
			results = append(results, item)
			continue
		}
		item.OK = true
		item.Subtitle = &sub
		results = append(results, item)
	}
	return ArchiveBatchResult{Results: results}, nil
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
		s.recordOp("convert", videoID, existing.Path, "", "error", err.Error())
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
		s.recordOp("convert", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, err
	}

	s.recordOp(
		"convert",
		updatedVideo.ID,
		targetPath,
		"",
		"ok",
		fmt.Sprintf("generated from %s", existing.FileName),
	)

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
		s.recordOp("offset", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	backupPath, err := subtitle.BackupFile(existing.Path)
	if err != nil {
		err = fmt.Errorf("backup before timing offset failed: %w", err)
		s.recordOp("offset", videoID, existing.Path, "", "error", err.Error())
		return domain.Subtitle{}, err
	}
	if err := subtitle.WriteFileBytes(shiftedData, existing.Path); err != nil {
		s.recordOp("offset", videoID, existing.Path, backupPath, "error", err.Error())
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
		s.recordOp("offset", videoID, existing.Path, backupPath, "error", err.Error())
		return domain.Subtitle{}, err
	}

	s.recordOp(
		"offset",
		updatedVideo.ID,
		existing.Path,
		backupPath,
		"ok",
		fmt.Sprintf("offset_ms=%d", offsetMS),
	)

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
		err = fmt.Errorf("backup before delete failed: %w", err)
		s.recordOp("delete", videoID, existing.Path, "", "error", err.Error())
		return err
	}
	if err := os.Remove(existing.Path); err != nil {
		s.recordOp("delete", videoID, existing.Path, backupPath, "error", err.Error())
		return err
	}

	_, _, err = s.refreshVideoSubtitles(videoID, "", nil)
	if err != nil {
		s.recordOp("delete", videoID, existing.Path, backupPath, "error", err.Error())
		return err
	}

	s.recordOp("delete", videoID, existing.Path, backupPath, "ok", "")
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
