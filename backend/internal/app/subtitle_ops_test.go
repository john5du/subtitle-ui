package app

import (
	"context"
	"errors"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func TestReadSubtitleContentReturnsStoredFileBytes(t *testing.T) {
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

	expected := "1\n00:00:01,000 --> 00:00:03,000\nhello preview\n"
	subPath := filepath.Join(movieDir, "movie-a.zh.srt")
	if err := os.WriteFile(subPath, []byte(expected), 0o644); err != nil {
		t.Fatalf("write subtitle: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	status := svc.RunFileScan(context.Background(), nil, nil)
	if status.Error != "" {
		t.Fatalf("scan status error: %s", status.Error)
	}

	page := mustListVideosPage(t, svc, domain.MediaTypeMovie, 20)
	if len(page.Items) != 1 {
		t.Fatalf("expected one movie, got %d", len(page.Items))
	}
	if len(page.Items[0].Subtitles) != 1 {
		t.Fatalf("expected one subtitle, got %d", len(page.Items[0].Subtitles))
	}

	video := page.Items[0]
	sub := video.Subtitles[0]
	content, err := svc.ReadSubtitleContent(video.ID, sub.ID)
	if err != nil {
		t.Fatalf("read subtitle content: %v", err)
	}
	if string(content) != expected {
		t.Fatalf("unexpected subtitle content: %q", string(content))
	}
}

func TestUploadSubtitleWithASSConversionPreservesOriginalSRT(t *testing.T) {
	base := t.TempDir()
	svc, video := newMovieServiceFixture(t, base, "")
	defer func() {
		_ = svc.Close()
	}()

	uploadPath := filepath.Join(base, "upload.zh.srt")
	srtContent := []byte("1\n00:00:01,000 --> 00:00:02,500\nhello upload\n")
	if err := os.WriteFile(uploadPath, srtContent, 0o644); err != nil {
		t.Fatalf("write upload source: %v", err)
	}
	file, err := os.Open(uploadPath)
	if err != nil {
		t.Fatalf("open upload source: %v", err)
	}
	defer file.Close()

	created, err := svc.UploadSubtitleWithOptions(video.ID, file, &multipart.FileHeader{Filename: "upload.zh.srt"}, "zh", "", SubtitleUploadOptions{
		ConvertTo:      "ass",
		SourceEncoding: "utf-8",
	})
	if err != nil {
		t.Fatalf("upload with ass conversion: %v", err)
	}
	if created.Format != "ass" {
		t.Fatalf("expected returned subtitle to be ass, got %s", created.Format)
	}
	if created.Source != domain.SubtitleSourceGenerated || created.SourceDetail != "movie-a.zh.srt" {
		t.Fatalf("unexpected generated subtitle source: %+v", created)
	}

	srtPath := filepath.Join(video.Directory, "movie-a.zh.srt")
	assPath := filepath.Join(video.Directory, "movie-a.zh.ass")
	if _, err := os.Stat(srtPath); err != nil {
		t.Fatalf("expected original srt to exist: %v", err)
	}
	assBytes, err := os.ReadFile(assPath)
	if err != nil {
		t.Fatalf("expected converted ass to exist: %v", err)
	}
	if !strings.Contains(string(assBytes), "Dialogue: 0,0:00:01.00,0:00:02.50") {
		t.Fatalf("expected converted dialogue, got %q", string(assBytes))
	}

	page := mustListVideosPage(t, svc, domain.MediaTypeMovie, 20)
	if len(page.Items) != 1 || len(page.Items[0].Subtitles) != 2 {
		t.Fatalf("expected srt and ass subtitles, got page=%+v", page)
	}
	uploadedSRT, ok := findSubtitleByFileName(page.Items[0].Subtitles, "movie-a.zh.srt")
	if !ok {
		t.Fatalf("expected uploaded srt subtitle in refreshed page")
	}
	if uploadedSRT.Source != domain.SubtitleSourceUpload || uploadedSRT.SourceDetail != "upload.zh.srt" {
		t.Fatalf("unexpected uploaded srt source: %+v", uploadedSRT)
	}
	generatedASS, ok := findSubtitleByFileName(page.Items[0].Subtitles, "movie-a.zh.ass")
	if !ok {
		t.Fatalf("expected generated ass subtitle in refreshed page")
	}
	if generatedASS.Source != domain.SubtitleSourceGenerated || generatedASS.SourceDetail != "movie-a.zh.srt" {
		t.Fatalf("unexpected generated ass source: %+v", generatedASS)
	}
}

func TestUploadAndReplaceSubtitleSources(t *testing.T) {
	base := t.TempDir()
	svc, video := newMovieServiceFixture(t, base, "")
	defer func() {
		_ = svc.Close()
	}()

	uploadPath := filepath.Join(base, "upload.zh.srt")
	if err := os.WriteFile(uploadPath, []byte("1\n00:00:01,000 --> 00:00:02,000\nuploaded\n"), 0o644); err != nil {
		t.Fatalf("write upload source: %v", err)
	}
	uploadFile, err := os.Open(uploadPath)
	if err != nil {
		t.Fatalf("open upload source: %v", err)
	}
	defer uploadFile.Close()

	created, err := svc.UploadSubtitle(video.ID, uploadFile, &multipart.FileHeader{Filename: "upload.zh.srt"}, "zh", "")
	if err != nil {
		t.Fatalf("upload subtitle: %v", err)
	}
	if created.Source != domain.SubtitleSourceUpload || created.SourceDetail != "upload.zh.srt" {
		t.Fatalf("unexpected uploaded subtitle source: %+v", created)
	}

	replacementPath := filepath.Join(base, "replacement.zh.ass")
	if err := os.WriteFile(replacementPath, []byte("[Script Info]\n"), 0o644); err != nil {
		t.Fatalf("write replacement source: %v", err)
	}
	replacementFile, err := os.Open(replacementPath)
	if err != nil {
		t.Fatalf("open replacement source: %v", err)
	}
	defer replacementFile.Close()

	replaced, err := svc.UploadSubtitle(video.ID, replacementFile, &multipart.FileHeader{Filename: "replacement.zh.ass"}, "", created.ID)
	if err != nil {
		t.Fatalf("replace subtitle: %v", err)
	}
	if replaced.Source != domain.SubtitleSourceUpload || replaced.SourceDetail != "replacement.zh.ass" {
		t.Fatalf("unexpected replaced subtitle source: %+v", replaced)
	}
}

func TestConvertExistingSRTSubtitleToASS(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:03,000 --> 00:00:04,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected existing subtitle, got %d", len(video.Subtitles))
	}

	created, err := svc.ConvertSubtitleToASS(video.ID, video.Subtitles[0].ID, SubtitleConvertOptions{SourceEncoding: "utf-8"})
	if err != nil {
		t.Fatalf("convert existing srt: %v", err)
	}
	if created.Format != "ass" {
		t.Fatalf("expected ass subtitle, got %s", created.Format)
	}
	if created.Source != domain.SubtitleSourceGenerated || created.SourceDetail != "movie-a.zh.srt" {
		t.Fatalf("unexpected generated subtitle source: %+v", created)
	}
	if _, err := os.Stat(video.Subtitles[0].Path); err != nil {
		t.Fatalf("expected original srt to remain: %v", err)
	}
	if _, err := os.Stat(filepath.Join(video.Directory, "movie-a.zh.ass")); err != nil {
		t.Fatalf("expected converted ass file: %v", err)
	}
	page := mustListVideosPage(t, svc, domain.MediaTypeMovie, 20)
	originalSRT, ok := findSubtitleByFileName(page.Items[0].Subtitles, "movie-a.zh.srt")
	if !ok {
		t.Fatalf("expected original srt subtitle")
	}
	if originalSRT.Source != domain.SubtitleSourceDirectory {
		t.Fatalf("expected original srt to keep directory source, got %+v", originalSRT)
	}
}

func TestDeleteSubtitleBacksUpAndLogs(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:01,000 --> 00:00:02,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected existing subtitle, got %d", len(video.Subtitles))
	}
	subtitlePath := video.Subtitles[0].Path

	if err := svc.DeleteSubtitle(video.ID, video.Subtitles[0].ID); err != nil {
		t.Fatalf("delete subtitle: %v", err)
	}
	if _, err := os.Stat(subtitlePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected subtitle file removed, stat err=%v", err)
	}
	backups, err := filepath.Glob(subtitlePath + ".bak.*")
	if err != nil {
		t.Fatalf("glob backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("expected one backup, got %d (%v)", len(backups), backups)
	}
	backupBytes, err := os.ReadFile(backups[0])
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(backupBytes) != srtContent {
		t.Fatalf("expected backup to contain original content, got %q", string(backupBytes))
	}

	deleteLog, ok := latestLogByAction(svc.ListLogs(20), "delete")
	if !ok {
		t.Fatalf("expected delete operation log")
	}
	if deleteLog.Status != "ok" || deleteLog.BackupPath == "" {
		t.Fatalf("unexpected delete log: %+v", deleteLog)
	}
	updated := mustGetVideo(t, svc, video.ID)
	if len(updated.Subtitles) != 0 {
		t.Fatalf("expected no subtitles after delete, got %+v", updated.Subtitles)
	}
}

func TestOffsetSubtitleTimingBacksUpRefreshesAndLogs(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:03,000 --> 00:00:04,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()
	if len(video.Subtitles) != 1 {
		t.Fatalf("expected existing subtitle, got %d", len(video.Subtitles))
	}

	updated, err := svc.OffsetSubtitleTiming(video.ID, video.Subtitles[0].ID, SubtitleTimingOffsetOptions{OffsetMS: -500})
	if err != nil {
		t.Fatalf("offset subtitle timing: %v", err)
	}
	if updated.ID != video.Subtitles[0].ID {
		t.Fatalf("expected same subtitle id after offset, got %s want %s", updated.ID, video.Subtitles[0].ID)
	}
	if updated.Source != domain.SubtitleSourceDirectory {
		t.Fatalf("expected subtitle source to be preserved, got %+v", updated)
	}

	contents, err := os.ReadFile(video.Subtitles[0].Path)
	if err != nil {
		t.Fatalf("read shifted subtitle: %v", err)
	}
	if !strings.Contains(string(contents), "00:00:02,500 --> 00:00:03,500") {
		t.Fatalf("expected shifted timing, got %q", string(contents))
	}
	backups, err := filepath.Glob(video.Subtitles[0].Path + ".bak.*")
	if err != nil {
		t.Fatalf("glob backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("expected one backup, got %d (%v)", len(backups), backups)
	}
	backupBytes, err := os.ReadFile(backups[0])
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(backupBytes) != srtContent {
		t.Fatalf("expected backup to contain original content, got %q", string(backupBytes))
	}

	offsetLog, ok := latestLogByAction(svc.ListLogs(20), "offset")
	if !ok {
		t.Fatalf("expected offset operation log")
	}
	if offsetLog.Status != "ok" || !strings.Contains(offsetLog.Message, "offset_ms=-500") {
		t.Fatalf("unexpected offset log: %+v", offsetLog)
	}
	if offsetLog.BackupPath == "" {
		t.Fatalf("expected offset log to include backup path")
	}
}

func TestOffsetSubtitleTimingRejectsInvalidRequest(t *testing.T) {
	base := t.TempDir()
	srtContent := "1\n00:00:01,000 --> 00:00:02,000\nexisting\n"
	svc, video := newMovieServiceFixture(t, base, srtContent)
	defer func() {
		_ = svc.Close()
	}()

	_, err := svc.OffsetSubtitleTiming(video.ID, video.Subtitles[0].ID, SubtitleTimingOffsetOptions{OffsetMS: -1500})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for negative resulting time, got %v", err)
	}
	contents, readErr := os.ReadFile(video.Subtitles[0].Path)
	if readErr != nil {
		t.Fatalf("read subtitle after failed offset: %v", readErr)
	}
	if string(contents) != srtContent {
		t.Fatalf("failed offset should not rewrite subtitle, got %q", string(contents))
	}
	backups, globErr := filepath.Glob(video.Subtitles[0].Path + ".bak.*")
	if globErr != nil {
		t.Fatalf("glob backups: %v", globErr)
	}
	if len(backups) != 0 {
		t.Fatalf("failed offset should not create backups, got %v", backups)
	}
}
