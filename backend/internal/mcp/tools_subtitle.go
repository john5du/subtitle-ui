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

type convertSubtitleIn struct {
	VideoID        string `json:"videoId" jsonschema:"video id"`
	SubtitleID     string `json:"subtitleId" jsonschema:"subtitle id"`
	SourceEncoding string `json:"sourceEncoding,omitempty" jsonschema:"source encoding for SRT (optional)"`
}

type offsetSubtitleIn struct {
	VideoID    string `json:"videoId" jsonschema:"video id"`
	SubtitleID string `json:"subtitleId" jsonschema:"subtitle id"`
	OffsetMs   int    `json:"offsetMs" jsonschema:"timing offset in milliseconds (can be negative)"`
}

type normalizeVideoIn struct {
	VideoID string `json:"videoId" jsonschema:"video id"`
}

type normalizeApplyVideoIn struct {
	VideoID string                              `json:"videoId" jsonschema:"video id"`
	Items   []domain.SubtitleNormalizeApplyItem `json:"items" jsonschema:"items from normalize_plan_video to apply"`
}

type normalizeSeasonIn struct {
	Path   string `json:"path,omitempty" jsonschema:"series path (prefer path or key)"`
	Key    string `json:"key,omitempty" jsonschema:"series key from list_tv_series"`
	Season int    `json:"season" jsonschema:"season number"`
}

type normalizeApplySeasonIn struct {
	Path   string                              `json:"path,omitempty" jsonschema:"series path"`
	Key    string                              `json:"key,omitempty" jsonschema:"series key"`
	Season int                                 `json:"season" jsonschema:"season number"`
	Items  []domain.SubtitleNormalizeApplyItem `json:"items" jsonschema:"items from normalize_plan_season to apply"`
}

type installFromPathIn struct {
	VideoID        string `json:"videoId" jsonschema:"video id"`
	Path           string `json:"path" jsonschema:"absolute path under movie/TV media roots"`
	Label          string `json:"label,omitempty" jsonschema:"language label e.g. zh, en, zh&en"`
	ReplaceID      string `json:"replaceId,omitempty" jsonschema:"existing subtitle id to replace"`
	ConvertTo      string `json:"convertTo,omitempty" jsonschema:"optional convert target e.g. ass"`
	SourceEncoding string `json:"sourceEncoding,omitempty" jsonschema:"source encoding when converting"`
	ArchiveEntry   string `json:"archiveEntry,omitempty" jsonschema:"entry path if path is zip/7z/rar with multiple subtitles"`
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
		Name:        "delete_subtitle",
		Description: "Delete a sidecar subtitle (backs up first). Destructive — confirm videoId/subtitleId.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in videoSubtitleIn) (*mcp.CallToolResult, map[string]any, error) {
		if err := svc.DeleteSubtitle(in.VideoID, in.SubtitleID); err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"ok": true, "videoId": in.VideoID, "subtitleId": in.SubtitleID}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "convert_subtitle_to_ass",
		Description: "Convert an SRT (or supported) subtitle to ASS next to the video.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in convertSubtitleIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		sub, err := svc.ConvertSubtitleToASS(in.VideoID, in.SubtitleID, app.SubtitleConvertOptions{
			SourceEncoding: in.SourceEncoding,
		})
		return nil, sub, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "offset_subtitle_timing",
		Description: "Shift subtitle timing by offsetMs (positive = delay). Backs up original file.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in offsetSubtitleIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		sub, err := svc.OffsetSubtitleTiming(in.VideoID, in.SubtitleID, app.SubtitleTimingOffsetOptions{
			OffsetMS: in.OffsetMs,
		})
		return nil, sub, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_plan_video",
		Description: "Preview language/filename normalize renames for one video. Always call this before normalize_apply_video.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeVideoIn) (*mcp.CallToolResult, domain.SubtitleNormalizePlan, error) {
		plan, err := svc.PlanNormalizeVideoSubtitles(in.VideoID)
		return nil, plan, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_apply_video",
		Description: "Apply selected normalize renames for one video. Pass items from normalize_plan_video (videoId, subtitleId, toPath).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeApplyVideoIn) (*mcp.CallToolResult, domain.SubtitleNormalizeApplyResult, error) {
		result, err := svc.ApplyNormalizeVideoSubtitles(in.VideoID, in.Items)
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_plan_season",
		Description: "Preview subtitle filename normalize for a whole TV season. Provide path or key plus season. Always plan before apply.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeSeasonIn) (*mcp.CallToolResult, domain.SubtitleNormalizePlan, error) {
		plan, err := svc.PlanNormalizeSeasonSubtitles(in.Path, in.Key, in.Season)
		return nil, plan, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "normalize_apply_season",
		Description: "Apply selected season normalize renames. Pass items from normalize_plan_season.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in normalizeApplySeasonIn) (*mcp.CallToolResult, domain.SubtitleNormalizeApplyResult, error) {
		result, err := svc.ApplyNormalizeSeasonSubtitles(in.Path, in.Key, in.Season, in.Items)
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "install_subtitle_from_path",
		Description: "Install a subtitle file from a path under MOVIE_MEDIA_ROOT or TV_MEDIA_ROOT onto a video. Rejects paths outside media roots. For archives with multiple entries, set archiveEntry.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in installFromPathIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		sub, err := svc.InstallSubtitleFromPath(in.VideoID, in.Path, in.Label, in.ReplaceID, app.SubtitleUploadOptions{
			ConvertTo:      in.ConvertTo,
			SourceEncoding: in.SourceEncoding,
			ArchiveEntry:   in.ArchiveEntry,
		})
		return nil, sub, err
	})
}
