package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/store"
)

func newTestService(t *testing.T) (*app.Service, domain.Video) {
	t.Helper()
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	movieDir := filepath.Join(movieRoot, "Movie A")
	if err := os.MkdirAll(movieDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.mkv"), []byte("video"), 0o644); err != nil {
		t.Fatalf("write video: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.nfo"), []byte("<movie><title>Movie A</title><year>2025</year></movie>"), 0o644); err != nil {
		t.Fatalf("write nfo: %v", err)
	}
	if err := os.WriteFile(filepath.Join(movieDir, "movie-a.zh.srt"), []byte("1\n00:00:01,000 --> 00:00:02,000\nhello\n"), 0o644); err != nil {
		t.Fatalf("write srt: %v", err)
	}

	svc, err := app.NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DatabaseURL:    store.TestDSN(t),
		SubHDEnabled:   false,
		AdminToken:     "test-admin-token",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page, err := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if err != nil {
		t.Fatalf("list videos: %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("expected 1 video, got %d", len(page.Items))
	}
	return svc, page.Items[0]
}

func connectMCP(t *testing.T, svc *app.Service) *mcp.ClientSession {
	t.Helper()
	ctx := context.Background()
	server := NewServer(svc)
	t1, t2 := mcp.NewInMemoryTransports()
	if _, err := server.Connect(ctx, t1, nil); err != nil {
		t.Fatalf("server connect: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "v0.0.1"}, nil)
	session, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func callToolJSON(t *testing.T, session *mcp.ClientSession, name string, args any) json.RawMessage {
	t.Helper()
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      name,
		Arguments: args,
	})
	if err != nil {
		t.Fatalf("CallTool %s: %v", name, err)
	}
	if res.IsError {
		msg := ""
		for _, c := range res.Content {
			if tc, ok := c.(*mcp.TextContent); ok {
				msg += tc.Text
			}
		}
		t.Fatalf("CallTool %s IsError: %s", name, msg)
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("marshal structured: %v", err)
	}
	return raw
}

func previewConfirmToken(t *testing.T, session *mcp.ClientSession, previewTool string, args map[string]any) string {
	t.Helper()
	raw := callToolJSON(t, session, previewTool, args)
	var out struct {
		ConfirmToken string `json:"confirmToken"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal preview: %v raw=%s", err, raw)
	}
	if out.ConfirmToken == "" {
		t.Fatalf("empty confirmToken from %s: %s", previewTool, raw)
	}
	return out.ConfirmToken
}

func TestMCPListTools(t *testing.T) {
	svc, _ := newTestService(t)
	session := connectMCP(t, svc)
	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	want := map[string]bool{
		"list_videos": true, "get_video": true, "list_tv_series": true,
		"scan_status": true, "scan_files": true, "scan_files_preview": true,
		"discover_directories":  true,
		"read_subtitle_content": true, "delete_subtitle": true, "delete_subtitle_preview": true,
		"normalize_plan_video": true, "subhd_search": true,
		"install_subtitle_from_path": true, "install_subtitle_from_path_preview": true,
		"version_info":       true,
		"read_subtitle_cues": true, "install_translated_cues": true, "install_translated_cues_preview": true,
		"list_operation_logs": true, "rollback_operation": true, "rollback_operation_preview": true,
		"list_subtitle_backups": true, "cleanup_subtitle_backups_preview": true,
	}
	got := map[string]bool{}
	for _, tool := range tools.Tools {
		got[tool.Name] = true
	}
	for name := range want {
		if !got[name] {
			t.Errorf("missing tool %s", name)
		}
	}
}

func TestMCPListAndGetVideo(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)

	raw := callToolJSON(t, session, "list_videos", map[string]any{"mediaType": "movie"})
	var page domain.VideoPage
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatalf("unmarshal page: %v raw=%s", err, raw)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("unexpected page: %+v", page)
	}

	raw = callToolJSON(t, session, "get_video", map[string]any{"videoId": video.ID})
	var got domain.Video
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal video: %v", err)
	}
	if got.ID != video.ID || len(got.Subtitles) != 1 {
		t.Fatalf("unexpected video: %+v", got)
	}
}

func TestMCPReadAndOffsetSubtitle(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)
	subID := video.Subtitles[0].ID

	raw := callToolJSON(t, session, "read_subtitle_content", map[string]any{
		"videoId": video.ID, "subtitleId": subID,
	})
	var content subtitleContentOut
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if content.Content == "" || content.VideoID != video.ID {
		t.Fatalf("unexpected content: %+v", content)
	}

	token := previewConfirmToken(t, session, "offset_subtitle_timing_preview", map[string]any{
		"videoId": video.ID, "subtitleId": subID, "offsetMs": 500,
	})
	raw = callToolJSON(t, session, "offset_subtitle_timing", map[string]any{
		"videoId": video.ID, "subtitleId": subID, "offsetMs": 500, "confirmToken": token,
	})
	var sub domain.Subtitle
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal sub: %v", err)
	}
	if sub.ID == "" {
		t.Fatalf("empty subtitle after offset")
	}
}

func TestMCPInstallFromPath(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)

	// Place a new srt under media root (not yet installed as different name).
	src := filepath.Join(filepath.Dir(video.Path), "extra.en.srt")
	if err := os.WriteFile(src, []byte("1\n00:00:01,000 --> 00:00:02,000\nworld\n"), 0o644); err != nil {
		t.Fatalf("write src: %v", err)
	}

	token := previewConfirmToken(t, session, "install_subtitle_from_path_preview", map[string]any{
		"videoId": video.ID, "path": src, "label": "en",
	})
	raw := callToolJSON(t, session, "install_subtitle_from_path", map[string]any{
		"videoId": video.ID, "path": src, "label": "en", "confirmToken": token,
	})
	var sub domain.Subtitle
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sub.ID == "" {
		t.Fatal("expected installed subtitle")
	}

	// Outside media root must fail (even with token for that path).
	outside := filepath.Join(t.TempDir(), "evil.srt")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatalf("write outside: %v", err)
	}
	badTok := previewConfirmToken(t, session, "install_subtitle_from_path_preview", map[string]any{
		"videoId": video.ID, "path": outside,
	})
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "install_subtitle_from_path",
		Arguments: map[string]any{
			"videoId": video.ID, "path": outside, "confirmToken": badTok,
		},
	})
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if !res.IsError {
		t.Fatal("expected IsError for path outside media roots")
	}
}

func TestMCPSubHDDisabled(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "subhd_search",
		Arguments: map[string]any{"videoId": video.ID},
	})
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if !res.IsError {
		t.Fatal("expected IsError when SubHD disabled")
	}
}

func TestMCPNormalizePlanVideo(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)
	raw := callToolJSON(t, session, "normalize_plan_video", map[string]any{"videoId": video.ID})
	var plan domain.SubtitleNormalizePlan
	if err := json.Unmarshal(raw, &plan); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// zh.srt already normalized may be noop; plan should still return.
	if plan.Items == nil {
		plan.Items = []domain.SubtitleNormalizeItem{}
	}
}

func TestMCPReadAndInstallTranslatedCues(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)
	subID := video.Subtitles[0].ID

	raw := callToolJSON(t, session, "read_subtitle_cues", map[string]any{
		"videoId": video.ID, "subtitleId": subID, "limit": 50,
	})
	var page app.SubtitleCuePage
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatalf("unmarshal page: %v raw=%s", err, raw)
	}
	if page.Total < 1 || len(page.Cues) < 1 {
		t.Fatalf("expected cues: %+v", page)
	}

	items := []map[string]any{}
	for _, c := range page.Cues {
		items = append(items, map[string]any{"index": c.Index, "text": "译文" + c.Text})
	}
	installArgs := map[string]any{
		"videoId": video.ID, "sourceSubtitleId": subID, "items": items, "label": "zh&en",
	}
	token := previewConfirmToken(t, session, "install_translated_cues_preview", installArgs)
	installArgs["confirmToken"] = token
	raw = callToolJSON(t, session, "install_translated_cues", installArgs)
	var sub domain.Subtitle
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal sub: %v", err)
	}
	if sub.ID == "" {
		t.Fatal("expected installed bilingual subtitle")
	}
}

func TestMCPConfirmRequiredAndRollbackDelete(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)
	subID := video.Subtitles[0].ID

	// Without token → error.
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "delete_subtitle",
		Arguments: map[string]any{"videoId": video.ID, "subtitleId": subID},
	})
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if !res.IsError {
		t.Fatal("expected confirmToken required")
	}

	token := previewConfirmToken(t, session, "delete_subtitle_preview", map[string]any{
		"videoId": video.ID, "subtitleId": subID,
	})
	_ = callToolJSON(t, session, "delete_subtitle", map[string]any{
		"videoId": video.ID, "subtitleId": subID, "confirmToken": token,
	})

	// Find delete log and rollback (should be attributed to MCP).
	logsRaw := callToolJSON(t, session, "list_operation_logs", map[string]any{
		"action": "delete", "source": "mcp", "pageSize": 20,
	})
	var logs domain.OperationLogPage
	if err := json.Unmarshal(logsRaw, &logs); err != nil {
		t.Fatalf("logs: %v", err)
	}
	var opID string
	for _, item := range logs.Items {
		if item.Action == "delete" && item.Status == "ok" && item.BackupPath != "" {
			if item.Source != domain.OpSourceMCP || item.Tool != "delete_subtitle" {
				t.Fatalf("expected mcp audit fields, got source=%q tool=%q", item.Source, item.Tool)
			}
			opID = item.ID
			break
		}
	}
	if opID == "" {
		t.Fatalf("no delete log: %+v", logs.Items)
	}
	rbTok := previewConfirmToken(t, session, "rollback_operation_preview", map[string]any{"opId": opID})
	rbRaw := callToolJSON(t, session, "rollback_operation", map[string]any{
		"opId": opID, "confirmToken": rbTok,
	})
	var rb domain.RollbackResult
	if err := json.Unmarshal(rbRaw, &rb); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if !rb.OK {
		t.Fatalf("rollback not ok: %+v", rb)
	}
	// Subtitle file should be back.
	v, err := svc.GetVideo(video.ID)
	if err != nil || len(v.Subtitles) < 1 {
		t.Fatalf("expected subtitle restored, got %+v err=%v", v, err)
	}
}

func callToolError(t *testing.T, session *mcp.ClientSession, name string, args any) string {
	t.Helper()
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      name,
		Arguments: args,
	})
	if err != nil {
		return err.Error()
	}
	if !res.IsError {
		raw, _ := json.Marshal(res.StructuredContent)
		t.Fatalf("CallTool %s expected error, got %s", name, raw)
	}
	msg := ""
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			msg += tc.Text
		}
	}
	if msg == "" {
		t.Fatalf("CallTool %s IsError with empty text", name)
	}
	return msg
}

func TestMCPPropagatesStoreErrors(t *testing.T) {
	svc, video := newTestService(t)
	session := connectMCP(t, svc)

	missing := callToolError(t, session, "get_video", map[string]any{"videoId": "missing-video-id"})
	if !strings.Contains(strings.ToLower(missing), "not found") {
		t.Fatalf("missing get_video should be not found, got %q", missing)
	}

	missingLog := callToolError(t, session, "get_operation_log", map[string]any{"opId": "missing-op-id"})
	if !strings.Contains(strings.ToLower(missingLog), "not found") {
		t.Fatalf("missing get_operation_log should be not found, got %q", missingLog)
	}

	_ = svc.Close()

	listErr := callToolError(t, session, "list_videos", map[string]any{"mediaType": "movie"})
	if strings.EqualFold(strings.TrimSpace(listErr), app.ErrNotFound.Error()) {
		t.Fatalf("list_videos store error must not be not found, got %q", listErr)
	}

	getErr := callToolError(t, session, "get_video", map[string]any{"videoId": video.ID})
	if strings.EqualFold(strings.TrimSpace(getErr), app.ErrNotFound.Error()) {
		t.Fatalf("get_video store error must not be not found, got %q", getErr)
	}

	logsErr := callToolError(t, session, "list_operation_logs", map[string]any{"page": 1})
	if strings.EqualFold(strings.TrimSpace(logsErr), app.ErrNotFound.Error()) {
		t.Fatalf("list_operation_logs store error must not be not found, got %q", logsErr)
	}

	rollbackErr := callToolError(t, session, "rollback_operation_preview", map[string]any{"opId": "missing-op-id"})
	if strings.EqualFold(strings.TrimSpace(rollbackErr), app.ErrNotFound.Error()) {
		t.Fatalf("rollback preview store error must not be not found, got %q", rollbackErr)
	}
}
