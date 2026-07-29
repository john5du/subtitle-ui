package mcp

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
)

type subhdSearchIn struct {
	VideoID string `json:"videoId" jsonschema:"video id to build default query"`
	Query   string `json:"q,omitempty" jsonschema:"override search query"`
	Page    int    `json:"page,omitempty" jsonschema:"page (default 1, max SUBHD_SEARCH_MAX_PAGES)"`
}

type subhdDownloadIn struct {
	VideoID      string `json:"videoId" jsonschema:"video id"`
	SID          string `json:"sid" jsonschema:"SubHD subtitle id from search"`
	Label        string `json:"label,omitempty" jsonschema:"language label"`
	ReplaceID    string `json:"replaceId,omitempty" jsonschema:"existing subtitle id to replace"`
	ArchiveEntry string `json:"archiveEntry,omitempty" jsonschema:"pick entry when archive has multiple subtitles"`
}

type subhdSeasonPacksIn struct {
	VideoID string `json:"videoId" jsonschema:"any episode video id of the series"`
	Query   string `json:"q,omitempty" jsonschema:"override season search query"`
	Season  int    `json:"season,omitempty" jsonschema:"season number for ranking packs"`
}

type subhdSeasonPrepareIn struct {
	SID                string   `json:"sid" jsonschema:"SubHD pack sid from season packs"`
	VideoIDs           []string `json:"videoIds" jsonschema:"episode video ids to map"`
	Season             int      `json:"season,omitempty" jsonschema:"season for episode-only filename matching"`
	LanguagePreference string   `json:"languagePreference,omitempty" jsonschema:"e.g. bilingual, zh, en"`
	FormatPreference   string   `json:"formatPreference,omitempty" jsonschema:"e.g. srt, ass"`
	SkipExisting       bool     `json:"skipExisting,omitempty" jsonschema:"skip episodes that already have subtitles"`
	Label              string   `json:"label,omitempty" jsonschema:"default label for installs"`
}

type subhdSeasonInstallIn struct {
	CacheToken string                    `json:"cacheToken" jsonschema:"token from subhd_season_prepare"`
	Mappings   []app.ArchiveBatchMapping `json:"mappings" jsonschema:"videoId + archiveEntry (+ optional label/convertTo)"`
}

func registerSubHDTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_search",
		Description: "Search SubHD for subtitles for a video. Requires SubHD enabled. Prefer bilingual results when listed first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSearchIn) (*mcp.CallToolResult, *subhd.SearchPage, error) {
		page, err := svc.SearchSubHD(ctx, in.VideoID, app.SubHDSearchOptions{
			Query: in.Query,
			Page:  in.Page,
		})
		return nil, page, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_download",
		Description: "Download a SubHD subtitle by sid and install next to the video. If the archive has multiple entries, error lists them — retry with archiveEntry.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdDownloadIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		sub, err := svc.InstallFromSubHD(ctx, in.VideoID, in.SID, app.SubHDInstallOptions{
			Label:        in.Label,
			ReplaceID:    in.ReplaceID,
			ArchiveEntry: in.ArchiveEntry,
		})
		return nil, sub, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_packs",
		Description: "Search SubHD season packs (合集) for a series. Pass any episode videoId of the series.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSeasonPacksIn) (*mcp.CallToolResult, app.SubHDSeasonPacksResult, error) {
		result, err := svc.SearchSubHDSeasonPacks(ctx, in.VideoID, app.SubHDSeasonPacksOptions{
			Query:  in.Query,
			Season: in.Season,
		})
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_prepare",
		Description: "Download a SubHD season pack once, cache it, list entries, and suggest episode mappings. Then review mappings and call subhd_season_install with cacheToken.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSeasonPrepareIn) (*mcp.CallToolResult, app.SubHDSeasonPrepareResult, error) {
		result, err := svc.PrepareSubHDSeasonPack(ctx, app.SubHDSeasonPrepareOptions{
			SID:                in.SID,
			VideoIDs:           in.VideoIDs,
			Season:             in.Season,
			LanguagePreference: in.LanguagePreference,
			FormatPreference:   in.FormatPreference,
			SkipExisting:       in.SkipExisting,
			Label:              in.Label,
		})
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_install",
		Description: "Install season pack entries using cacheToken from subhd_season_prepare and explicit mappings (videoId, archiveEntry).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSeasonInstallIn) (*mcp.CallToolResult, app.SubHDSeasonInstallResult, error) {
		result, err := svc.InstallSubHDSeasonPack(ctx, app.SubHDSeasonInstallOptions{
			CacheToken: in.CacheToken,
			Mappings:   in.Mappings,
		})
		return nil, result, err
	})
}
