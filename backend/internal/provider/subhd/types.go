package subhd

import (
	"errors"
	"fmt"
	"strings"

	"subtitle-ui/backend/internal/archive"
)

var (
	ErrDisabled            = errors.New("subhd provider disabled")
	ErrRateLimited         = errors.New("subhd rate limited")
	ErrCaptchaFailed       = errors.New("subhd captcha failed")
	ErrTokenExpired        = errors.New("subhd download token expired")
	ErrUnsupportedArchive  = errors.New("unsupported archive format")
	ErrMultipleEntries     = errors.New("archive contains multiple subtitle files")
	ErrNoSubtitleInArchive = errors.New("archive contains no installable subtitle")
	ErrNotInstallable      = errors.New("subtitle format is not installable")
	ErrEmptySID            = errors.New("empty subtitle id")
	ErrEmptyQuery          = errors.New("empty search query")
	ErrProvider            = errors.New("subhd provider error")
	// ErrParseFragile is returned only for severe HTML layout breaks (optional hard-fail paths).
	ErrParseFragile = errors.New("subhd html layout may have changed")
)

// Search parse warning codes (machine-readable for UI / health).
const (
	// WarningHTMLLayout means response looked like a SubHD page but card markup did not match.
	WarningHTMLLayout = "html_layout_changed"
	// WarningCardsUnparsed means cards were split but none yielded a valid SID.
	WarningCardsUnparsed = "cards_unparsed"
)

// MultipleEntriesError is returned when a SubHD archive needs an explicit entry pick.
type MultipleEntriesError struct {
	Entries []archive.Entry
}

func (e *MultipleEntriesError) Error() string {
	if e == nil || len(e.Entries) == 0 {
		return ErrMultipleEntries.Error()
	}
	names := make([]string, 0, len(e.Entries))
	for _, ent := range e.Entries {
		names = append(names, ent.Path)
	}
	return fmt.Sprintf("%s: %s", ErrMultipleEntries.Error(), strings.Join(names, ", "))
}

func (e *MultipleEntriesError) Unwrap() error {
	return ErrMultipleEntries
}

// SearchResult is one subtitle listing from SubHD search HTML.
type SearchResult struct {
	SID        string   `json:"sid"`
	Title      string   `json:"title"`
	Version    string   `json:"version"`
	Langs      []string `json:"langs,omitempty"`
	Format     string   `json:"format,omitempty"`
	SourceTag  string   `json:"sourceTag,omitempty"`
	Size       string   `json:"size,omitempty"`
	Downloads  string   `json:"downloads,omitempty"`
	Publisher  string   `json:"publisher,omitempty"`
	DoubanID   string   `json:"doubanId,omitempty"`
	Installable bool    `json:"installable"`
}

// SearchPage is a parsed search response.
type SearchPage struct {
	Query string         `json:"query"`
	Page  int            `json:"page"`
	Total string         `json:"total,omitempty"`
	Items []SearchResult `json:"items"`
	// Warning is a machine-readable parse issue code (see Warning* constants).
	// Search still returns 200 with partial/empty items for graceful degrade.
	Warning string `json:"warning,omitempty"`
}

// ParseStats is cumulative SubHD HTML parse telemetry (process lifetime).
type ParseStats struct {
	Searches       int64 `json:"searches"`
	ParseOK        int64 `json:"parseOk"`
	EmptyResults   int64 `json:"emptyResults"`
	LayoutWarnings int64 `json:"layoutWarnings"`
	CardWarnings   int64 `json:"cardWarnings"`
}

// DownloadedFile is raw payload from SubHD CDN after download API.
type DownloadedFile struct {
	SID      string
	URL      string
	FileName string
	Data     []byte
}

// ResolvedSubtitle is a single installable subtitle extracted from a download.
type ResolvedSubtitle struct {
	SID      string
	FileName string
	Ext      string
	Data     []byte
	Source   string // original version/name hint
	URL      string // CDN download URL at fetch time
}
