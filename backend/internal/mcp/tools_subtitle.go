package mcp

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/domain"
)

type videoSubtitleIn struct {
	VideoID    string `json:"videoId" jsonschema:"video id"`
	SubtitleID string `json:"subtitleId" jsonschema:"subtitle id"`
}

type deleteSubtitleIn struct {
	VideoID      string `json:"videoId" jsonschema:"video id"`
	SubtitleID   string `json:"subtitleId" jsonschema:"subtitle id"`
	ConfirmToken string `json:"confirmToken,omitempty" jsonschema:"from delete_subtitle_preview"`
}

type convertSubtitleIn struct {
	VideoID        string `json:"videoId" jsonschema:"video id"`
	SubtitleID     string `json:"subtitleId" jsonschema:"subtitle id"`
	SourceEncoding string `json:"sourceEncoding,omitempty" jsonschema:"source encoding for SRT (optional)"`
	ConfirmToken   string `json:"confirmToken,omitempty" jsonschema:"from convert_subtitle_to_ass_preview"`
}

type offsetSubtitleIn struct {
	VideoID      string `json:"videoId" jsonschema:"video id"`
	SubtitleID   string `json:"subtitleId" jsonschema:"subtitle id"`
	OffsetMs     int    `json:"offsetMs" jsonschema:"timing offset in milliseconds (can be negative)"`
	ConfirmToken string `json:"confirmToken,omitempty" jsonschema:"from offset_subtitle_timing_preview"`
}

type normalizeVideoIn struct {
	VideoID string `json:"videoId" jsonschema:"video id"`
}

type normalizeApplyVideoIn struct {
	VideoID      string                              `json:"videoId" jsonschema:"video id"`
	Items        []domain.SubtitleNormalizeApplyItem `json:"items" jsonschema:"items from normalize_plan_video"`
	ConfirmToken string                              `json:"confirmToken,omitempty" jsonschema:"from normalize_apply_video_preview"`
}

type normalizeSeasonIn struct {
	Path   string `json:"path,omitempty" jsonschema:"series path (prefer path or key)"`
	Key    string `json:"key,omitempty" jsonschema:"series key from list_tv_series"`
	Season int    `json:"season" jsonschema:"season number"`
}

type normalizeApplySeasonIn struct {
	Path         string                              `json:"path,omitempty"`
	Key          string                              `json:"key,omitempty"`
	Season       int                                 `json:"season"`
	Items        []domain.SubtitleNormalizeApplyItem `json:"items"`
	ConfirmToken string                              `json:"confirmToken,omitempty" jsonschema:"from normalize_apply_season_preview"`
}

type installFromPathIn struct {
	VideoID        string `json:"videoId" jsonschema:"video id"`
	Path           string `json:"path" jsonschema:"absolute path under movie/TV media roots"`
	Label          string `json:"label,omitempty"`
	ReplaceID      string `json:"replaceId,omitempty"`
	ConvertTo      string `json:"convertTo,omitempty"`
	SourceEncoding string `json:"sourceEncoding,omitempty"`
	ArchiveEntry   string `json:"archiveEntry,omitempty"`
	ConfirmToken   string `json:"confirmToken,omitempty" jsonschema:"from install_subtitle_from_path_preview"`
}

type subtitleContentOut struct {
	VideoID    string `json:"videoId"`
	SubtitleID string `json:"subtitleId"`
	Content    string `json:"content"`
}

func registerSubtitleTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "read_subtitle_content",
		Description: "Read subtitle file text content for a video subtitle id.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in videoSubtitleIn) (*mcp.CallToolResult, subtitleContentOut, error) {
		data, err := svc.ReadSubtitleContent(in.VideoID, in.SubtitleID)
		if err != nil {
			return nil, subtitleContentOut{}, err
		}
		return nil, subtitleContentOut{
			VideoID:    in.VideoID,
			SubtitleID: in.SubtitleID,
			Content:    string(data),
		}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "delete_subtitle_preview",
		Description: "Preview delete and issue confirmToken. Required before delete_subtitle.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in videoSubtitleIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"videoId": in.VideoID, "subtitleId": in.SubtitleID}
		tok, err := svc.IssueMCPConfirmToken("delete_subtitle", params)
		if err != nil {
			return nil, nil, err
		}
		video, err := svc.GetVideo(in.VideoID)
		if err != nil {
			return nil, nil, err
		}
		var path string
		for _, sub := range video.Subtitles {
			if sub.ID == in.SubtitleID {
				path = sub.Path
				break
			}
		}
		if path == "" {
			return nil, nil, app.ErrNotFound
		}
		return nil, map[string]any{
			"videoId": in.VideoID, "subtitleId": in.SubtitleID, "path": path,
			"willBackup": true, "confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds,
		}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "delete_subtitle",
		Description: "Delete a sidecar subtitle (backs up first). Requires confirmToken from delete_subtitle_preview with the same videoId/subtitleId.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in deleteSubtitleIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"videoId": in.VideoID, "subtitleId": in.SubtitleID}
		if err := svc.ValidateMCPConfirmToken("delete_subtitle", params, in.ConfirmToken); err != nil {
			return nil, nil, err
		}
		ctx := app.WithOpAudit(context.Background(), domain.OpSourceMCP, "delete_subtitle")
		if err := svc.DeleteSubtitleCtx(ctx, in.VideoID, in.SubtitleID); err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"ok": true, "videoId": in.VideoID, "subtitleId": in.SubtitleID}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "convert_subtitle_to_ass_preview",
		Description: "Preview SRT→ASS convert and issue confirmToken.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in convertSubtitleIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"videoId": in.VideoID, "subtitleId": in.SubtitleID, "sourceEncoding": in.SourceEncoding}
		tok, err := svc.IssueMCPConfirmToken("convert_subtitle_to_ass", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds, "params": params}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "convert_subtitle_to_ass",
		Description: "Convert SRT to ASS. Requires confirmToken from convert_subtitle_to_ass_preview.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in convertSubtitleIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		params := map[string]any{"videoId": in.VideoID, "subtitleId": in.SubtitleID, "sourceEncoding": in.SourceEncoding}
		if err := svc.ValidateMCPConfirmToken("convert_subtitle_to_ass", params, in.ConfirmToken); err != nil {
			return nil, domain.Subtitle{}, err
		}
		ctx := app.WithOpAudit(context.Background(), domain.OpSourceMCP, "convert_subtitle_to_ass")
		sub, err := svc.ConvertSubtitleToASSCtx(ctx, in.VideoID, in.SubtitleID, app.SubtitleConvertOptions{SourceEncoding: in.SourceEncoding})
		return nil, sub, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "offset_subtitle_timing_preview",
		Description: "Preview timing offset and issue confirmToken.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in offsetSubtitleIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"videoId": in.VideoID, "subtitleId": in.SubtitleID, "offsetMs": in.OffsetMs}
		tok, err := svc.IssueMCPConfirmToken("offset_subtitle_timing", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds, "willBackup": true, "params": params}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "offset_subtitle_timing",
		Description: "Shift subtitle timing (backs up first). Requires confirmToken from offset_subtitle_timing_preview.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in offsetSubtitleIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		params := map[string]any{"videoId": in.VideoID, "subtitleId": in.SubtitleID, "offsetMs": in.OffsetMs}
		if err := svc.ValidateMCPConfirmToken("offset_subtitle_timing", params, in.ConfirmToken); err != nil {
			return nil, domain.Subtitle{}, err
		}
		ctx := app.WithOpAudit(context.Background(), domain.OpSourceMCP, "offset_subtitle_timing")
		sub, err := svc.OffsetSubtitleTimingCtx(ctx, in.VideoID, in.SubtitleID, app.SubtitleTimingOffsetOptions{OffsetMS: in.OffsetMs})
		return nil, sub, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_plan_video",
		Description: "Preview language/filename normalize renames for one video. Then call normalize_apply_video_preview → normalize_apply_video.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeVideoIn) (*mcp.CallToolResult, domain.SubtitleNormalizePlan, error) {
		plan, err := svc.PlanNormalizeVideoSubtitles(in.VideoID)
		return nil, plan, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_apply_video_preview",
		Description: "Issue confirmToken for normalize_apply_video (same videoId + items as apply).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeApplyVideoIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"videoId": in.VideoID, "items": in.Items}
		tok, err := svc.IssueMCPConfirmToken("normalize_apply_video", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds, "itemCount": len(in.Items)}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_apply_video",
		Description: "Apply normalize renames. Requires confirmToken from normalize_apply_video_preview with identical items.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeApplyVideoIn) (*mcp.CallToolResult, domain.SubtitleNormalizeApplyResult, error) {
		params := map[string]any{"videoId": in.VideoID, "items": in.Items}
		if err := svc.ValidateMCPConfirmToken("normalize_apply_video", params, in.ConfirmToken); err != nil {
			return nil, domain.SubtitleNormalizeApplyResult{}, err
		}
		ctx := app.WithOpAudit(context.Background(), domain.OpSourceMCP, "normalize_apply_video")
		result, err := svc.ApplyNormalizeVideoSubtitlesCtx(ctx, in.VideoID, in.Items)
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_plan_season",
		Description: "Preview season normalize. Then normalize_apply_season_preview → normalize_apply_season.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeSeasonIn) (*mcp.CallToolResult, domain.SubtitleNormalizePlan, error) {
		plan, err := svc.PlanNormalizeSeasonSubtitles(in.Path, in.Key, in.Season)
		return nil, plan, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_apply_season_preview",
		Description: "Issue confirmToken for normalize_apply_season.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeApplySeasonIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"path": in.Path, "key": in.Key, "season": in.Season, "items": in.Items}
		tok, err := svc.IssueMCPConfirmToken("normalize_apply_season", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds, "itemCount": len(in.Items)}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_apply_season",
		Description: "Apply season normalize. Requires confirmToken from normalize_apply_season_preview.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeApplySeasonIn) (*mcp.CallToolResult, domain.SubtitleNormalizeApplyResult, error) {
		params := map[string]any{"path": in.Path, "key": in.Key, "season": in.Season, "items": in.Items}
		if err := svc.ValidateMCPConfirmToken("normalize_apply_season", params, in.ConfirmToken); err != nil {
			return nil, domain.SubtitleNormalizeApplyResult{}, err
		}
		ctx := app.WithOpAudit(context.Background(), domain.OpSourceMCP, "normalize_apply_season")
		result, err := svc.ApplyNormalizeSeasonSubtitlesCtx(ctx, in.Path, in.Key, in.Season, in.Items)
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "install_subtitle_from_path_preview",
		Description: "Preview path install and issue confirmToken.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in installFromPathIn) (*mcp.CallToolResult, map[string]any, error) {
		params := installPathParams(in)
		tok, err := svc.IssueMCPConfirmToken("install_subtitle_from_path", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds, "params": params}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "install_subtitle_from_path",
		Description: "Install subtitle from media-root path. Requires confirmToken from install_subtitle_from_path_preview.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in installFromPathIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		params := installPathParams(in)
		if err := svc.ValidateMCPConfirmToken("install_subtitle_from_path", params, in.ConfirmToken); err != nil {
			return nil, domain.Subtitle{}, err
		}
		ctx := app.WithOpAudit(context.Background(), domain.OpSourceMCP, "install_subtitle_from_path")
		sub, err := svc.InstallSubtitleFromPathCtx(ctx, in.VideoID, in.Path, in.Label, in.ReplaceID, app.SubtitleUploadOptions{
			ConvertTo: in.ConvertTo, SourceEncoding: in.SourceEncoding, ArchiveEntry: in.ArchiveEntry,
		})
		return nil, sub, err
	})
}

func installPathParams(in installFromPathIn) map[string]any {
	return map[string]any{
		"videoId": in.VideoID, "path": in.Path, "label": in.Label, "replaceId": in.ReplaceID,
		"convertTo": in.ConvertTo, "sourceEncoding": in.SourceEncoding, "archiveEntry": in.ArchiveEntry,
	}
}
