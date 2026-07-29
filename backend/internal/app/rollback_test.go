package app

import (
	"os"
	"path/filepath"
	"testing"

	"subtitle-ui/backend/internal/config"
)

func TestRollbackDeleteViaBackup(t *testing.T) {
	base := t.TempDir()
	svc, video := newMovieServiceFixture(t, base, "1\n00:00:01,000 --> 00:00:02,000\nhello\n")
	defer func() { _ = svc.Close() }()
	sub := video.Subtitles[0]
	path := sub.Path

	if err := svc.DeleteSubtitle(video.ID, sub.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected file removed")
	}

	logs := svc.ListLogs(20)
	var opID string
	for _, log := range logs {
		if log.Action == "delete" && log.Status == "ok" && log.BackupPath != "" {
			opID = log.ID
			break
		}
	}
	if opID == "" {
		t.Fatal("missing delete log")
	}

	result, err := svc.RollbackOperation(opID)
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if !result.OK {
		t.Fatalf("not ok: %+v", result)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("restored file missing: %v", err)
	}
	v, ok := svc.GetVideo(video.ID)
	if !ok || len(v.Subtitles) < 1 {
		t.Fatalf("db not refreshed: %+v", v)
	}
}

func TestConfirmTokenRoundTrip(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	_ = os.MkdirAll(movieRoot, 0o755)
	_ = os.MkdirAll(tvRoot, 0o755)
	svc, err := NewService(configFromRoots(movieRoot, tvRoot, base))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()

	params := map[string]any{"videoId": "v1", "subtitleId": "s1"}
	// nil vs empty slice should hash the same for optional list fields.
	paramsNil := map[string]any{"movieDirs": nil, "tvDirs": nil}
	paramsEmpty := map[string]any{"movieDirs": []string{}, "tvDirs": []string{}}
	tokA, err := svc.IssueMCPConfirmToken("scan_files", paramsNil)
	if err != nil {
		t.Fatalf("issue nil: %v", err)
	}
	if err := svc.ValidateMCPConfirmToken("scan_files", paramsEmpty, tokA.ConfirmToken); err != nil {
		t.Fatalf("nil/empty slice mismatch: %v", err)
	}

	tok, err := svc.IssueMCPConfirmToken("delete_subtitle", params)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := svc.ValidateMCPConfirmToken("delete_subtitle", params, tok.ConfirmToken); err != nil {
		t.Fatalf("validate: %v", err)
	}
	// Single-use: second validate fails.
	if err := svc.ValidateMCPConfirmToken("delete_subtitle", params, tok.ConfirmToken); err == nil {
		t.Fatal("expected replay rejected")
	}
	if err := svc.ValidateMCPConfirmToken("delete_subtitle", params, ""); err == nil {
		t.Fatal("expected empty token error")
	}
	tok2, _ := svc.IssueMCPConfirmToken("delete_subtitle", params)
	if err := svc.ValidateMCPConfirmToken("other_tool", params, tok2.ConfirmToken); err == nil {
		t.Fatal("expected tool mismatch")
	}
}

func configFromRoots(movie, tv, base string) config.Config {
	return config.Config{
		MovieMediaRoot: movie,
		TVMediaRoot:    tv,
		DBPath:         filepath.Join(base, "test.sqlite3"),
		AdminToken:     "secret",
	}
}
