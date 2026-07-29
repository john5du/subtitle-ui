package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
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
		DBPath:         filepath.Join(base, "test.sqlite3"),
		SubHDEnabled:   false,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	if status := svc.RunFileScan(context.Background(), nil, nil); status.Error != "" {
		t.Fatalf("scan: %s", status.Error)
	}
	page := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
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
		t.Fatalf("CallTool %s IsError: %+v", name, res.Content)
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("marshal structured: %v", err)
	}
	return raw
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
		"scan_status": true, "scan_files": true, "discover_directories": true,
		"read_subtitle_content": true, "delete_subtitle": true,
		"normalize_plan_video": true, "subhd_search": true,
		"install_subtitle_from_path": true, "version_info": true,
		"read_subtitle_cues": true, "install_translated_cues": true,
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

	raw = callToolJSON(t, session, "offset_subtitle_timing", map[string]any{
		"videoId": video.ID, "subtitleId": subID, "offsetMs": 500,
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

	raw := callToolJSON(t, session, "install_subtitle_from_path", map[string]any{
		"videoId": video.ID,
		"path":    src,
		"label":   "en",
	})
	var sub domain.Subtitle
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sub.ID == "" {
		t.Fatal("expected installed subtitle")
	}

	// Outside media root must fail.
	outside := filepath.Join(t.TempDir(), "evil.srt")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatalf("write outside: %v", err)
	}
	res, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "install_subtitle_from_path",
		Arguments: map[string]any{"videoId": video.ID, "path": outside},
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
	raw = callToolJSON(t, session, "install_translated_cues", map[string]any{
		"videoId":          video.ID,
		"sourceSubtitleId": subID,
		"items":            items,
		"label":            "zh&en",
	})
	var sub domain.Subtitle
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("unmarshal sub: %v", err)
	}
	if sub.ID == "" {
		t.Fatal("expected installed bilingual subtitle")
	}
}
