package subhd

import "errors"

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
)

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
}
