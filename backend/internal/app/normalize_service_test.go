package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
)

func TestNormalizeSubtitlesPlanAndApply(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	videoPath := filepath.Join(movieDir, "movie-a.mkv")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte(sampleNFO("Movie A", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	legacySub := filepath.Join(movieDir, "movie-a.CHS.srt")
	if err := os.WriteFile(legacySub, []byte("1\n00:00:01,000 --> 00:00:02,000\nhi\n"), 0o644); err != nil {
		t.Fatalf("write sub: %v", err)
	}
	canonicalSub := filepath.Join(movieDir, "movie-a.en.srt")
	if err := os.WriteFile(canonicalSub, []byte("1\n00:00:01,000 --> 00:00:02,000\nen\n"), 0o644); err != nil {
		t.Fatalf("write en sub: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	status := svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	video := page.Items[0]

	plan, err := svc.PlanNormalizeVideoSubtitles(video.ID)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	var renameItem *domain.SubtitleNormalizeItem
	var noopCount int
	for i := range plan.Items {
		item := &plan.Items[i]
		if item.Status == domain.SubtitleNormalizeRename && strings.EqualFold(item.FromFileName, "movie-a.CHS.srt") {
			renameItem = item
		}
		if item.Status == domain.SubtitleNormalizeNoop {
			noopCount++
		}
	}
	if renameItem == nil {
		t.Fatalf("expected rename for CHS subtitle, plan=%+v", plan.Items)
	}
	if renameItem.ToFileName != "movie-a.zh.srt" || renameItem.ToLabel != "zh" {
		t.Fatalf("unexpected rename target: %+v", renameItem)
	}
	if noopCount < 1 {
		t.Fatalf("expected at least one noop item for already-canonical en sub")
	}

	apply, err := svc.ApplyNormalizeVideoSubtitles(video.ID, []domain.SubtitleNormalizeApplyItem{{
		VideoID:    video.ID,
		SubtitleID: renameItem.SubtitleID,
		ToPath:     renameItem.ToPath,
	}})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if apply.Renamed != 1 || apply.Failed != 0 {
		t.Fatalf("unexpected apply result: %+v", apply)
	}
	if _, err := os.Stat(legacySub); !os.IsNotExist(err) {
		t.Fatalf("legacy path should be gone, err=%v", err)
	}
	if _, err := os.Stat(renameItem.ToPath); err != nil {
		t.Fatalf("canonical path missing: %v", err)
	}

	reloaded, ok := svc.GetVideo(video.ID)
	if !ok {
		t.Fatalf("reload video")
	}
	if _, found := findSubtitleByFileName(reloaded.Subtitles, "movie-a.zh.srt"); !found {
		t.Fatalf("expected zh subtitle after rename, got %+v", reloaded.Subtitles)
	}
	// Source should remain directory after normalize refresh.
	zh, _ := findSubtitleByFileName(reloaded.Subtitles, "movie-a.zh.srt")
	if zh.Source != domain.SubtitleSourceDirectory {
		t.Fatalf("expected directory source preserved, got %q", zh.Source)
	}
}

func TestNormalizeSubtitlesDetectsBilingualFromContent(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	movieDir := filepath.Join(movieRoot, "Movie B")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir movie dir: %v", err)
	}
	videoPath := filepath.Join(movieDir, "movie-b.mkv")
	if err := os.WriteFile(videoPath, []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-b.nfo"), []byte(sampleNFO("Movie B", "2025")), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	// Mislabeled as zh but content is bilingual.
	bilingualSRT := `1
00:00:01,000 --> 00:00:03,000
你好世界
Hello world

2
00:00:04,000 --> 00:00:06,000
再见朋友
Goodbye friend

3
00:00:07,000 --> 00:00:09,000
今天天气很好
The weather is nice today
`
	misnamed := filepath.Join(movieDir, "movie-b.zh.srt")
	if err := os.WriteFile(misnamed, []byte(bilingualSRT), 0o644); err != nil {
		t.Fatalf("write sub: %v", err)
	}
	// Legacy dash bilingual on disk.
	legacyDash := filepath.Join(movieDir, "movie-b.zh-en.ass")
	if err := os.WriteFile(legacyDash, []byte("[Script Info]\nTitle: test\n"), 0o644); err != nil {
		t.Fatalf("write ass: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() { _ = svc.Close() }()

	status := svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	video := page.Items[0]

	plan, err := svc.PlanNormalizeVideoSubtitles(video.ID)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}

	var contentUpgrade, dashFix *domain.SubtitleNormalizeItem
	for i := range plan.Items {
		item := &plan.Items[i]
		if strings.EqualFold(item.FromFileName, "movie-b.zh.srt") {
			contentUpgrade = item
		}
		if strings.EqualFold(item.FromFileName, "movie-b.zh-en.ass") {
			dashFix = item
		}
	}
	if contentUpgrade == nil {
		t.Fatalf("missing plan for mislabeled zh srt: %+v", plan.Items)
	}
	if contentUpgrade.ToLabel != "zh&en" || contentUpgrade.ToFileName != "movie-b.zh&en.srt" {
		t.Fatalf("expected content bilingual upgrade, got %+v", contentUpgrade)
	}
	if contentUpgrade.Status != domain.SubtitleNormalizeRename {
		t.Fatalf("expected rename status, got %+v", contentUpgrade)
	}
	if dashFix == nil {
		t.Fatalf("missing plan for legacy zh-en: %+v", plan.Items)
	}
	if dashFix.ToLabel != "zh&en" || dashFix.ToFileName != "movie-b.zh&en.ass" {
		t.Fatalf("expected legacy dash → zh&en, got %+v", dashFix)
	}
}
