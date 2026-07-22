package subhd

import (
	"errors"
	"fmt"
	"log"
	"path"
	"strings"

	"subtitle-ui/backend/internal/archive"
)

// ResolveInstallable turns a downloaded payload into one subtitle file (zip/7z/rar-aware).
func ResolveInstallable(dl *DownloadedFile, preferredEntry string) (*ResolvedSubtitle, error) {
	if dl == nil || len(dl.Data) == 0 {
		sid := ""
		if dl != nil {
			sid = dl.SID
		}
		log.Printf("subhd resolve failed sid=%s reason=empty_download preferredEntry=%q",
			sid, preferredEntry)
		return nil, fmt.Errorf("%w: empty download", ErrProvider)
	}
	name := dl.FileName
	if name == "" {
		name = "subtitle.bin"
	}
	ext := strings.ToLower(path.Ext(name))
	bytes := len(dl.Data)

	if archive.IsArchive(dl.Data, name) {
		entryName, data, err := archive.ExtractSubtitle(dl.Data, name, preferredEntry)
		if err != nil {
			logResolveArchiveError(dl.SID, name, bytes, preferredEntry, err)
			return nil, mapArchiveError(err)
		}
		return &ResolvedSubtitle{
			SID:      dl.SID,
			FileName: entryName,
			Ext:      strings.ToLower(path.Ext(entryName)),
			Data:     data,
			Source:   name,
			URL:      dl.URL,
		}, nil
	}

	if archive.IsUnsupportedArchive(dl.Data, name) {
		if ext == "" {
			ext = "archive"
		}
		log.Printf("subhd resolve failed sid=%s reason=unsupported_archive fileName=%q ext=%s bytes=%d",
			dl.SID, name, ext, bytes)
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedArchive, ext)
	}

	if !archive.IsAllowedSubtitleExt(ext) {
		log.Printf("subhd resolve failed sid=%s reason=not_installable fileName=%q ext=%s bytes=%d",
			dl.SID, name, ext, bytes)
		return nil, fmt.Errorf("%w: %s", ErrNotInstallable, ext)
	}
	return &ResolvedSubtitle{
		SID:      dl.SID,
		FileName: name,
		Ext:      ext,
		Data:     dl.Data,
		Source:   name,
		URL:      dl.URL,
	}, nil
}

func logResolveArchiveError(sid, fileName string, bytes int, preferredEntry string, err error) {
	reason := "archive_error"
	entryCount := 0
	var multi *archive.MultipleEntriesError
	switch {
	case errors.As(err, &multi):
		reason = "multiple_entries"
		entryCount = len(multi.Entries)
	case errors.Is(err, archive.ErrNoSubtitle):
		reason = "no_subtitle"
	case errors.Is(err, archive.ErrUnsupported):
		reason = "unsupported"
	case errors.Is(err, archive.ErrNotArchive):
		reason = "not_archive"
	case errors.Is(err, archive.ErrEntryNotFound):
		reason = "entry_not_found"
	case errors.Is(err, archive.ErrInvalidArchive):
		reason = "invalid_archive"
	case errors.Is(err, archive.ErrReadFailed):
		reason = "read_failed"
	}
	if entryCount > 0 {
		log.Printf("subhd resolve failed sid=%s reason=%s fileName=%q bytes=%d preferredEntry=%q entries=%d err=%v",
			sid, reason, fileName, bytes, preferredEntry, entryCount, err)
		return
	}
	log.Printf("subhd resolve failed sid=%s reason=%s fileName=%q bytes=%d preferredEntry=%q err=%v",
		sid, reason, fileName, bytes, preferredEntry, err)
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
