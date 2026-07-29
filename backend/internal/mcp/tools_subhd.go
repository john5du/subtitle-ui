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
	Query   string `json:"q,omitempty"`
	Page    int    `json:"page,omitempty"`
}

type subhdDownloadIn struct {
	VideoID      string `json:"videoId"`
	SID          string `json:"sid"`
	Label        string `json:"label,omitempty"`
	ReplaceID    string `json:"replaceId,omitempty"`
	ArchiveEntry string `json:"archiveEntry,omitempty"`
	ConfirmToken string `json:"confirmToken,omitempty" jsonschema:"from subhd_download_preview"`
}

type subhdSeasonPacksIn struct {
	VideoID string `json:"videoId"`
	Query   string `json:"q,omitempty"`
	Season  int    `json:"season,omitempty"`
}

type subhdSeasonPrepareIn struct {
	SID                string   `json:"sid"`
	VideoIDs           []string `json:"videoIds"`
	Season             int      `json:"season,omitempty"`
	LanguagePreference string   `json:"languagePreference,omitempty"`
	FormatPreference   string   `json:"formatPreference,omitempty"`
	SkipExisting       bool     `json:"skipExisting,omitempty"`
	Label              string   `json:"label,omitempty"`
}

type subhdSeasonInstallIn struct {
	CacheToken   string                    `json:"cacheToken"`
	Mappings     []app.ArchiveBatchMapping `json:"mappings"`
	ConfirmToken string                    `json:"confirmToken,omitempty" jsonschema:"from subhd_season_install_preview"`
}

func registerSubHDTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_search",
		Description: "Search SubHD for subtitles. Requires SubHD enabled.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSearchIn) (*mcp.CallToolResult, *subhd.SearchPage, error) {
		page, err := svc.SearchSubHD(ctx, in.VideoID, app.SubHDSearchOptions{Query: in.Query, Page: in.Page})
		return nil, page, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_download_preview",
		Description: "Issue confirmToken for subhd_download.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in subhdDownloadIn) (*mcp.CallToolResult, map[string]any, error) {
		params := subhdDownloadParams(in)
		tok, err := svc.IssueMCPConfirmToken("subhd_download", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_download",
		Description: "Download SubHD subtitle by sid. Requires confirmToken from subhd_download_preview.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdDownloadIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		params := subhdDownloadParams(in)
		if err := svc.ValidateMCPConfirmToken("subhd_download", params, in.ConfirmToken); err != nil {
			return nil, domain.Subtitle{}, err
		}
		sub, err := svc.InstallFromSubHD(ctx, in.VideoID, in.SID, app.SubHDInstallOptions{
			Label: in.Label, ReplaceID: in.ReplaceID, ArchiveEntry: in.ArchiveEntry,
		})
		return nil, sub, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_packs",
		Description: "Search SubHD season packs. Pass any episode videoId.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSeasonPacksIn) (*mcp.CallToolResult, app.SubHDSeasonPacksResult, error) {
		result, err := svc.SearchSubHDSeasonPacks(ctx, in.VideoID, app.SubHDSeasonPacksOptions{Query: in.Query, Season: in.Season})
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_prepare",
		Description: "Download season pack once, cache, suggest mappings. Then subhd_season_install_preview → subhd_season_install.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSeasonPrepareIn) (*mcp.CallToolResult, app.SubHDSeasonPrepareResult, error) {
		result, err := svc.PrepareSubHDSeasonPack(ctx, app.SubHDSeasonPrepareOptions{
			SID: in.SID, VideoIDs: in.VideoIDs, Season: in.Season,
			LanguagePreference: in.LanguagePreference, FormatPreference: in.FormatPreference,
			SkipExisting: in.SkipExisting, Label: in.Label,
		})
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_install_preview",
		Description: "Issue confirmToken for subhd_season_install.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in subhdSeasonInstallIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"cacheToken": in.CacheToken, "mappings": in.Mappings}
		tok, err := svc.IssueMCPConfirmToken("subhd_season_install", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds, "mappingCount": len(in.Mappings)}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "subhd_season_install",
		Description: "Install season pack mappings. Requires confirmToken from subhd_season_install_preview.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in subhdSeasonInstallIn) (*mcp.CallToolResult, app.SubHDSeasonInstallResult, error) {
		params := map[string]any{"cacheToken": in.CacheToken, "mappings": in.Mappings}
		if err := svc.ValidateMCPConfirmToken("subhd_season_install", params, in.ConfirmToken); err != nil {
			return nil, app.SubHDSeasonInstallResult{}, err
		}
		result, err := svc.InstallSubHDSeasonPack(ctx, app.SubHDSeasonInstallOptions{CacheToken: in.CacheToken, Mappings: in.Mappings})
		return nil, result, err
	})
}

func subhdDownloadParams(in subhdDownloadIn) map[string]any {
	return map[string]any{
		"videoId": in.VideoID, "sid": in.SID, "label": in.Label,
		"replaceId": in.ReplaceID, "archiveEntry": in.ArchiveEntry,
	}
}
