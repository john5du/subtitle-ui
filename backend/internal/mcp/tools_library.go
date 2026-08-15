package mcp

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/domain"
)

type listVideosIn struct {
	Query     string `json:"q,omitempty" jsonschema:"search title/filename/ids"`
	MediaType string `json:"mediaType,omitempty" jsonschema:"movie or tv"`
	Dir       string `json:"dir,omitempty" jsonschema:"directory filter (TV series path)"`
	Page      int    `json:"page,omitempty" jsonschema:"page number (default 1)"`
	PageSize  int    `json:"pageSize,omitempty" jsonschema:"page size (default 30, max 200)"`
	SortBy    string `json:"sortBy,omitempty" jsonschema:"sort field"`
	SortOrder string `json:"sortOrder,omitempty" jsonschema:"asc or desc"`
}

type getVideoIn struct {
	VideoID string `json:"videoId" jsonschema:"video id"`
}

type listTVSeriesIn struct {
	Query     string `json:"q,omitempty" jsonschema:"search series title"`
	Page      int    `json:"page,omitempty" jsonschema:"page number (default 1)"`
	PageSize  int    `json:"pageSize,omitempty" jsonschema:"page size"`
	SortBy    string `json:"sortBy,omitempty" jsonschema:"sort field"`
	SortOrder string `json:"sortOrder,omitempty" jsonschema:"asc or desc"`
}

func registerLibraryTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_videos",
		Description: "List library videos (movies/TV episodes) with pagination. Use mediaType=tv and dir=<series path> for episodes of a series. Check subtitles[] on each item for existing sidecar files.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in listVideosIn) (*mcp.CallToolResult, domain.VideoPage, error) {
		page := in.Page
		if page < 1 {
			page = 1
		}
		pageSize := in.PageSize
		if pageSize < 1 {
			pageSize = 30
		}
		pageData, err := svc.ListVideosPage(in.Query, in.MediaType, in.Dir, page, pageSize, in.SortBy, in.SortOrder)
		if err != nil {
			return nil, domain.VideoPage{}, err
		}
		return nil, pageData, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_video",
		Description: "Get one video by id including full subtitles[] list (path, language, format, source).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in getVideoIn) (*mcp.CallToolResult, domain.Video, error) {
		video, err := svc.GetVideo(in.VideoID)
		if err != nil {
			return nil, domain.Video{}, err
		}
		return nil, video, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_tv_series",
		Description: "List TV series summaries with videoCount and noSubtitleCount. Use path/key from results with list_videos(mediaType=tv, dir=path) for episodes.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in listTVSeriesIn) (*mcp.CallToolResult, domain.TVSeriesPage, error) {
		page := in.Page
		if page < 1 {
			page = 1
		}
		pageSize := in.PageSize
		if pageSize < 1 {
			pageSize = 30
		}
		pageData, err := svc.ListTVSeriesPage(in.Query, page, pageSize, in.SortBy, in.SortOrder)
		if err != nil {
			return nil, domain.TVSeriesPage{}, err
		}
		return nil, pageData, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "version_info",
		Description: "Return subtitle-ui version and database type.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, domain.VersionInfo, error) {
		return nil, svc.VersionInfo(), nil
	})
}
