package app

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

const (
	defaultCuePageLimit = 80
	maxCuePageLimit     = 200
)

// SubtitleCuePage is a paginated SRT cue list for agent translation.
type SubtitleCuePage struct {
	VideoID    string           `json:"videoId"`
	SubtitleID string           `json:"subtitleId"`
	Format     string           `json:"format"`
	Total      int              `json:"total"`
	Offset     int              `json:"offset"`
	Limit      int              `json:"limit"`
	Cues       []SubtitleCueDTO `json:"cues"`
}

// SubtitleCueDTO is one cue exposed to MCP/agents.
type SubtitleCueDTO struct {
	Index   int    `json:"index"`
	StartMS int    `json:"startMs"`
	EndMS   int    `json:"endMs"`
	Text    string `json:"text"`
}

// TranslatedCueItem is agent-provided translation for one source cue index.
type TranslatedCueItem struct {
	Index int    `json:"index"`
	Text  string `json:"text"`
}

// InstallTranslatedCuesOptions installs a bilingual (or mono) SRT from agent translations.
type InstallTranslatedCuesOptions struct {
	VideoID          string
	SourceSubtitleID string
	Items            []TranslatedCueItem
	// Label defaults to zh&en for bilingual output.
	Label string
	// ReplaceID optionally replaces an existing sidecar.
	ReplaceID string
	// TargetLang is the language of Items.Text (default zh).
	// bilingual line order: Chinese on top, English below.
	TargetLang string
}

// ReadSubtitleCues returns paginated SRT cues (offset/limit). Only .srt is supported.
func (s *Service) ReadSubtitleCues(videoID string, subtitleID string, offset int, limit int) (SubtitleCuePage, error) {
	data, format, err := s.readSubtitleSRTBytes(videoID, subtitleID)
	if err != nil {
		return SubtitleCuePage{}, err
	}
	cues, err := subtitle.ParseSRTCues(data)
	if err != nil {
		return SubtitleCuePage{}, fmt.Errorf("%w: %v", ErrBadRequest, err)
	}
	if offset < 0 {
		offset = 0
	}
	if limit < 1 {
		limit = defaultCuePageLimit
	}
	if limit > maxCuePageLimit {
		limit = maxCuePageLimit
	}
	total := len(cues)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := make([]SubtitleCueDTO, 0, end-offset)
	for _, cue := range cues[offset:end] {
		page = append(page, SubtitleCueDTO{
			Index:   cue.Index,
			StartMS: cue.StartMS,
			EndMS:   cue.EndMS,
			Text:    subtitle.CueText(cue),
		})
	}
	return SubtitleCuePage{
		VideoID:    videoID,
		SubtitleID: subtitleID,
		Format:     format,
		Total:      total,
		Offset:     offset,
		Limit:      limit,
		Cues:       page,
	}, nil
}

// InstallTranslatedCues merges agent translations into source timing and installs bilingual SRT.
// Untranslated cue indexes keep the source text (single line). Prefer one call with all items.
func (s *Service) InstallTranslatedCues(opts InstallTranslatedCuesOptions) (domain.Subtitle, error) {
	return s.InstallTranslatedCuesCtx(context.Background(), opts)
}

// InstallTranslatedCuesCtx is InstallTranslatedCues with audit context.
func (s *Service) InstallTranslatedCuesCtx(ctx context.Context, opts InstallTranslatedCuesOptions) (domain.Subtitle, error) {
	videoID := strings.TrimSpace(opts.VideoID)
	sourceID := strings.TrimSpace(opts.SourceSubtitleID)
	if videoID == "" || sourceID == "" {
		return domain.Subtitle{}, fmt.Errorf("%w: videoId and sourceSubtitleId are required", ErrBadRequest)
	}
	if len(opts.Items) == 0 {
		return domain.Subtitle{}, fmt.Errorf("%w: items must not be empty (provide at least one translated cue)", ErrBadRequest)
	}

	data, _, err := s.readSubtitleSRTBytes(videoID, sourceID)
	if err != nil {
		return domain.Subtitle{}, err
	}
	sourceCues, err := subtitle.ParseSRTCues(data)
	if err != nil {
		return domain.Subtitle{}, fmt.Errorf("%w: %v", ErrBadRequest, err)
	}

	byIndex := make(map[int]string, len(opts.Items))
	for _, item := range opts.Items {
		if item.Index < 1 || item.Index > len(sourceCues) {
			return domain.Subtitle{}, fmt.Errorf("%w: cue index %d out of range (1-%d)", ErrBadRequest, item.Index, len(sourceCues))
		}
		if _, dup := byIndex[item.Index]; dup {
			return domain.Subtitle{}, fmt.Errorf("%w: duplicate cue index %d", ErrBadRequest, item.Index)
		}
		// Drop blank-only segments so FormatSRTCues never emits mid-cue blank lines.
		normalized := subtitle.NormalizeCueLines([]string{item.Text})
		byIndex[item.Index] = strings.Join(normalized, "\n")
	}

	targetLang := strings.ToLower(strings.TrimSpace(opts.TargetLang))
	if targetLang == "" {
		targetLang = "zh"
	}

	out := make([]subtitle.Cue, 0, len(sourceCues))
	for _, cue := range sourceCues {
		original := subtitle.CueText(cue)
		translated, ok := byIndex[cue.Index]
		if !ok || translated == "" {
			// Keep source text for untranslated / empty translations.
			out = append(out, subtitle.Cue{
				Index:   cue.Index,
				StartMS: cue.StartMS,
				EndMS:   cue.EndMS,
				Lines:   append([]string(nil), cue.Lines...),
			})
			continue
		}
		var lines []string
		switch {
		case targetLang == "en":
			// Translation is English; Chinese (source) on top. Source should be Chinese.
			lines = subtitle.NormalizeCueLines([]string{original, translated})
		default:
			// Translation is Chinese (default); Chinese on top, English (source) below.
			// Source should be English (or other L2) for a true bilingual track.
			lines = subtitle.NormalizeCueLines([]string{translated, original})
		}
		out = append(out, subtitle.Cue{
			Index:   cue.Index,
			StartMS: cue.StartMS,
			EndMS:   cue.EndMS,
			Lines:   lines,
		})
	}

	payload := subtitle.FormatSRTCues(out)
	label := strings.TrimSpace(opts.Label)
	if label == "" {
		label = "zh&en"
	}
	uploadName := "translated.zh&en.srt"
	return s.installSubtitleBytes(ctx, videoID, payload, uploadName, label, strings.TrimSpace(opts.ReplaceID), SubtitleUploadOptions{})
}

func (s *Service) readSubtitleSRTBytes(videoID string, subtitleID string) ([]byte, string, error) {
	video, err := s.GetVideo(videoID)
	if err != nil {
		return nil, "", err
	}
	existing, found := findSubtitle(video.Subtitles, subtitleID)
	if !found {
		return nil, "", ErrNotFound
	}
	if !s.isWithinMediaRoots(existing.Path) {
		return nil, "", ErrUnsafePath
	}
	ext := strings.ToLower(filepath.Ext(existing.Path))
	if ext != ".srt" {
		return nil, "", fmt.Errorf("%w: only srt subtitles support cue read/translate (got %s)", ErrBadRequest, ext)
	}
	data, err := s.ReadSubtitleContent(videoID, subtitleID)
	if err != nil {
		return nil, "", err
	}
	format := strings.TrimPrefix(ext, ".")
	if format == "" {
		format = "srt"
	}
	return data, format, nil
}
