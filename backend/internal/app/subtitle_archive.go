package app

import (
	"context"
	"fmt"
	"mime/multipart"
	"path"
	"strings"

	"subtitle-ui/backend/internal/archive"
)

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
		sub, installErr := s.installSubtitleBytes(context.Background(), item.VideoID, data, uploadName, m.Label, "", SubtitleUploadOptions{
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
