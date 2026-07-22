package jellyfin_test

import (
	"strings"
	"testing"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

func TestRewriteM3U8RelativeAndAbsolute(t *testing.T) {
	playlist := strings.Join([]string{
		"#EXTM3U",
		"#EXT-X-VERSION:6",
		`#EXT-X-MAP:URI="init.mp4"`,
		"#EXTINF:6.0,",
		"seg0.mp4",
		"#EXTINF:6.0,",
		"https://jf.example/Videos/item/hls/seg1.mp4?api_key=secret",
		"#EXTINF:6.0,",
		"../item/hls/seg2.mp4",
		"",
	}, "\n")
	out := jellyfin.RewriteM3U8(playlist, "/Videos/item/master.m3u8?x=1", func(up string) string {
		if strings.Contains(up, "api_key") {
			t.Fatalf("secret leaked into rewrite input: %s", up)
		}
		return "PROXY:" + up
	})
	if !strings.Contains(out, `URI="PROXY:/Videos/item/init.mp4"`) {
		t.Fatalf("map uri: %s", out)
	}
	if !strings.Contains(out, "PROXY:/Videos/item/seg0.mp4") {
		t.Fatalf("relative seg: %s", out)
	}
	if !strings.Contains(out, "PROXY:/Videos/item/hls/seg1.mp4") {
		t.Fatalf("absolute seg: %s", out)
	}
	// ../ from /Videos/item/ should collapse to /Videos/item/hls/seg2.mp4
	if !strings.Contains(out, "PROXY:/Videos/item/hls/seg2.mp4") {
		t.Fatalf("parent-relative seg: %s", out)
	}
}

func TestValidateUpstreamPath(t *testing.T) {
	if err := jellyfin.ValidateUpstreamPath("/Videos/x/stream"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "http://evil", "//evil", "/", "Videos/x", "/Videos/x/../y", "/Videos/x/%2e%2e/y"} {
		if err := jellyfin.ValidateUpstreamPath(bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestValidateHLSSegmentPath(t *testing.T) {
	item := "item-1"
	ok := []string{
		"/Videos/item-1/master.m3u8?MediaSourceId=ms",
		"/videos/item-1/hls1/main/0.ts",
		"/Audio/item-1/stream.m3u8",
		"/Videos/ITEM-1/seg0.mp4",
	}
	for _, p := range ok {
		if err := jellyfin.ValidateHLSSegmentPath(p, item); err != nil {
			t.Fatalf("expected ok for %q: %v", p, err)
		}
	}
	// GUID with/without hyphens
	guid := "a422806f3f08a807ed050c9d3229fe7d"
	dashed := "/videos/a422806f-3f08-a807-ed05-0c9d3229fe7d/master.m3u8"
	if err := jellyfin.ValidateHLSSegmentPath(dashed, guid); err != nil {
		t.Fatalf("guid hyphen form: %v", err)
	}
	bad := []string{
		"/Videos/other/stream?static=true",
		"/System/Info",
		"/Users",
		"/Items?Recursive=true",
		"/Videos/item-1/../other/stream",
		"/Videos/",
		"/Videos",
		"http://evil/Videos/item-1/x",
	}
	for _, p := range bad {
		if err := jellyfin.ValidateHLSSegmentPath(p, item); err == nil {
			t.Fatalf("expected error for %q", p)
		}
	}
}

func TestIsM3U8Path(t *testing.T) {
	if !jellyfin.IsM3U8Path("/Videos/x/master.m3u8?q=1") {
		t.Fatal("master")
	}
	if !jellyfin.IsM3U8Path("/Videos/x/Main.M3U8") {
		t.Fatal("case")
	}
	// path is segment file; query must not make it a playlist
	if jellyfin.IsM3U8Path("/Videos/x/seg0.ts?name=clip.m3u8") {
		t.Fatal("query false positive")
	}
	if jellyfin.IsM3U8Path("/Videos/x/seg0.mp4") {
		t.Fatal("mp4")
	}
}
