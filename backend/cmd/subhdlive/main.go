package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"subtitle-ui/backend/internal/provider/subhd"
)

func main() {
	base := envOr("SUBHD_BASE_URL", "https://subhd.me")
	proxy := envOr("SUBHD_PROXY", "")
	sid := ""
	query := "Dune Part Two"
	if len(os.Args) > 1 {
		// if looks like sid (short alnum) download direct; else search
		arg := os.Args[1]
		if len(arg) <= 10 && isSID(arg) {
			sid = arg
		} else {
			query = arg
		}
	}

	c := subhd.New(subhd.Options{
		Enabled:     true,
		BaseURL:     base,
		ProxyURL:    proxy,
		MinInterval: time.Second,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	fmt.Println("base:", base)
	fmt.Println("proxy:", proxy)

	if sid == "" {
		fmt.Println("search:", query)
		page, err := c.Search(ctx, query, 1)
		if err != nil {
			fmt.Println("SEARCH ERR:", err)
			os.Exit(1)
		}
		fmt.Printf("items=%d total=%s\n", len(page.Items), page.Total)
		for i, it := range page.Items {
			if i >= 8 {
				break
			}
			fmt.Printf("  [%d] sid=%s installable=%v fmt=%q size=%q ver=%s\n",
				i, it.SID, it.Installable, it.Format, it.Size, truncate(it.Version, 55))
			if sid == "" && it.Installable && (it.Format == "ASS" || it.Format == "SRT" || it.Format == "SSA") {
				sid = it.SID
			}
		}
	}

	if sid == "" {
		fmt.Println("no installable sid")
		os.Exit(2)
	}

	fmt.Println("download sid:", sid)
	dl, err := c.Download(ctx, sid)
	if err != nil {
		fmt.Println("DOWNLOAD ERR:", err)
		os.Exit(3)
	}
	fmt.Printf("raw: name=%s bytes=%d url=%s\n", dl.FileName, len(dl.Data), dl.URL)

	resolved, err := subhd.ResolveInstallable(dl, "")
	_ = os.MkdirAll("tmp", 0o755)
	if err != nil {
		fmt.Println("RESOLVE ERR:", err)
		out := filepath.Join("tmp", "subhd-raw-"+sid+filepath.Ext(dl.FileName))
		_ = os.WriteFile(out, dl.Data, 0o644)
		fmt.Println("saved raw:", out)
		os.Exit(4)
	}
	out := filepath.Join("tmp", "subhd-"+sid+resolved.Ext)
	if err := os.WriteFile(out, resolved.Data, 0o644); err != nil {
		fmt.Println("write err:", err)
		os.Exit(5)
	}
	head := resolved.Data
	if len(head) > 180 {
		head = head[:180]
	}
	fmt.Printf("OK: %s (%d bytes)\nhead: %q\n", out, len(resolved.Data), string(head))
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func isSID(s string) bool {
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		return false
	}
	return len(s) >= 4
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "..."
}
