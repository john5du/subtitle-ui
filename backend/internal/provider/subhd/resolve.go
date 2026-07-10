package subhd

import (
	"errors"
	"fmt"
	"path"
	"strings"

	"subtitle-ui/backend/internal/archive"
)

// ResolveInstallable turns a downloaded payload into one subtitle file (zip/7z/rar-aware).
func ResolveInstallable(dl *DownloadedFile, preferredEntry string) (*ResolvedSubtitle, error) {
	if dl == nil || len(dl.Data) == 0 {
		return nil, fmt.Errorf("%w: empty download", ErrProvider)
	}
	name := dl.FileName
	if name == "" {
		name = "subtitle.bin"
	}
	ext := strings.ToLower(path.Ext(name))

	if archive.IsArchive(dl.Data, name) {
		entryName, data, err := archive.ExtractSubtitle(dl.Data, name, preferredEntry)
		if err != nil {
			return nil, mapArchiveError(err)
		}
		return &ResolvedSubtitle{
			SID:      dl.SID,
			FileName: entryName,
			Ext:      strings.ToLower(path.Ext(entryName)),
			Data:     data,
			Source:   name,
		}, nil
	}

	if archive.IsUnsupportedArchive(dl.Data, name) {
		if ext == "" {
			ext = "archive"
		}
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedArchive, ext)
	}

	if !archive.IsAllowedSubtitleExt(ext) {
		return nil, fmt.Errorf("%w: %s", ErrNotInstallable, ext)
	}
	return &ResolvedSubtitle{
		SID:      dl.SID,
		FileName: name,
		Ext:      ext,
		Data:     dl.Data,
		Source:   name,
	}, nil
}

func mapArchiveError(err error) error {
	if err == nil {
		return nil
	}
	var multi *archive.MultipleEntriesError
	if errors.As(err, &multi) {
		return &MultipleEntriesError{Entries: multi.Entries}
	}
	switch {
	case errors.Is(err, archive.ErrNoSubtitle):
		return ErrNoSubtitleInArchive
	case errors.Is(err, archive.ErrUnsupported):
		return fmt.Errorf("%w: %v", ErrUnsupportedArchive, err)
	case errors.Is(err, archive.ErrNotArchive):
		return fmt.Errorf("%w: %v", ErrNotInstallable, err)
	case errors.Is(err, archive.ErrEntryNotFound):
		return fmt.Errorf("%w: %v", ErrProvider, err)
	case errors.Is(err, archive.ErrInvalidArchive), errors.Is(err, archive.ErrReadFailed):
		return fmt.Errorf("%w: %v", ErrProvider, err)
	default:
		return fmt.Errorf("%w: %v", ErrProvider, err)
	}
}
