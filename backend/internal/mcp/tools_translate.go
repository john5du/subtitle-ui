package mcp

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/domain"
)

type readCuesIn struct {
	VideoID    string `json:"videoId" jsonschema:"video id"`
	SubtitleID string `json:"subtitleId" jsonschema:"source subtitle id (SRT only)"`
	Offset     int    `json:"offset,omitempty" jsonschema:"0-based cue offset (default 0)"`
	Limit      int    `json:"limit,omitempty" jsonschema:"page size (default 80, max 200)"`
}

type translatedItemIn struct {
	Index int    `json:"index" jsonschema:"1-based cue index from read_subtitle_cues"`
	Text  string `json:"text" jsonschema:"translated text for this cue (target language)"`
}

type installTranslatedIn struct {
	VideoID          string             `json:"videoId" jsonschema:"video id"`
	SourceSubtitleID string             `json:"sourceSubtitleId" jsonschema:"source SRT subtitle id"`
	Items            []translatedItemIn `json:"items" jsonschema:"translations; non-empty"`
	Label            string             `json:"label,omitempty"`
	ReplaceID        string             `json:"replaceId,omitempty"`
	TargetLang       string             `json:"targetLang,omitempty"`
	ConfirmToken     string             `json:"confirmToken,omitempty" jsonschema:"from install_translated_cues_preview"`
}

func registerTranslateTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name: "read_subtitle_cues",
		Description: "Parse an SRT subtitle into timed cues for agent translation. " +
			"Returns paginated cues. Then install_translated_cues_preview → install_translated_cues.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in readCuesIn) (*mcp.CallToolResult, app.SubtitleCuePage, error) {
		page, err := svc.ReadSubtitleCues(in.VideoID, in.SubtitleID, in.Offset, in.Limit)
		return nil, page, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "install_translated_cues_preview",
		Description: "Issue confirmToken for install_translated_cues (same args as install).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in installTranslatedIn) (*mcp.CallToolResult, map[string]any, error) {
		params := translatedInstallParams(in)
		tok, err := svc.IssueMCPConfirmToken("install_translated_cues", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{
			"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds,
			"itemCount": len(in.Items),
		}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name: "install_translated_cues",
		Description: "Install bilingual zh&en SRT from agent translations. Requires confirmToken from install_translated_cues_preview. " +
			"Timing from sourceSubtitleId. Default targetLang=zh: [Chinese, English original].",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in installTranslatedIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		params := translatedInstallParams(in)
		if err := svc.ValidateMCPConfirmToken("install_translated_cues", params, in.ConfirmToken); err != nil {
			return nil, domain.Subtitle{}, err
		}
		items := make([]app.TranslatedCueItem, 0, len(in.Items))
		for _, it := range in.Items {
			items = append(items, app.TranslatedCueItem{Index: it.Index, Text: it.Text})
		}
		ctx = app.WithOpAudit(ctx, domain.OpSourceMCP, "install_translated_cues")
		sub, err := svc.InstallTranslatedCuesCtx(ctx, app.InstallTranslatedCuesOptions{
			VideoID: in.VideoID, SourceSubtitleID: in.SourceSubtitleID, Items: items,
			Label: in.Label, ReplaceID: in.ReplaceID, TargetLang: in.TargetLang,
		})
		return nil, sub, err
	})
}

func translatedInstallParams(in installTranslatedIn) map[string]any {
	items := make([]map[string]any, 0, len(in.Items))
	for _, it := range in.Items {
		items = append(items, map[string]any{"index": it.Index, "text": it.Text})
	}
	return map[string]any{
		"videoId": in.VideoID, "sourceSubtitleId": in.SourceSubtitleID, "items": items,
		"label": in.Label, "replaceId": in.ReplaceID, "targetLang": in.TargetLang,
	}
}
