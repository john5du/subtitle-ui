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
	SourceSubtitleID string             `json:"sourceSubtitleId" jsonschema:"source SRT subtitle id (timing + original text)"`
	Items            []translatedItemIn `json:"items" jsonschema:"translations; omit indexes keep source text. Prefer one install with all items."`
	Label            string             `json:"label,omitempty" jsonschema:"language label (default zh&en)"`
	ReplaceID        string             `json:"replaceId,omitempty" jsonschema:"optional existing subtitle id to replace"`
	TargetLang       string             `json:"targetLang,omitempty" jsonschema:"language of items.text: zh (default) or en"`
}

func registerTranslateTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name: "read_subtitle_cues",
		Description: "Parse an SRT subtitle into timed cues for agent translation. " +
			"Returns paginated cues with index/startMs/endMs/text. Only .srt is supported. " +
			"Translate text only; never invent timings. Then call install_translated_cues once with all items.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in readCuesIn) (*mcp.CallToolResult, app.SubtitleCuePage, error) {
		page, err := svc.ReadSubtitleCues(in.VideoID, in.SubtitleID, in.Offset, in.Limit)
		return nil, page, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name: "install_translated_cues",
		Description: "Install a bilingual zh&en SRT from agent translations. " +
			"Timing always comes from sourceSubtitleId. Each item is {index, text} where text is the translation. " +
			"Default targetLang=zh: lines are [Chinese translation, English original]. " +
			"targetLang=en: lines are [Chinese original, English translation]. " +
			"Untranslated indexes keep source text. Prefer one call after translating all pages. Label defaults to zh&en.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in installTranslatedIn) (*mcp.CallToolResult, domain.Subtitle, error) {
		items := make([]app.TranslatedCueItem, 0, len(in.Items))
		for _, it := range in.Items {
			items = append(items, app.TranslatedCueItem{Index: it.Index, Text: it.Text})
		}
		sub, err := svc.InstallTranslatedCues(app.InstallTranslatedCuesOptions{
			VideoID:          in.VideoID,
			SourceSubtitleID: in.SourceSubtitleID,
			Items:            items,
			Label:            in.Label,
			ReplaceID:        in.ReplaceID,
			TargetLang:       in.TargetLang,
		})
		return nil, sub, err
	})
}
