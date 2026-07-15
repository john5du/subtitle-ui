package app

import (
	"context"

	"subtitle-ui/backend/internal/provider/subhd"
)

// SubHDProvider is the HTTP/HTML surface used by app for SubHD search and download.
// Concrete *subhd.Client implements it; tests may inject fakes.
type SubHDProvider interface {
	Enabled() bool
	Search(ctx context.Context, query string, page int) (*subhd.SearchPage, error)
	Download(ctx context.Context, sid string) (*subhd.DownloadedFile, error)
	ListTitlePacks(ctx context.Context, doubanID string) (*subhd.TitlePage, error)
	PageURL(sid string) string
}

// Compile-time check that the production client satisfies SubHDProvider.
var _ SubHDProvider = (*subhd.Client)(nil)
