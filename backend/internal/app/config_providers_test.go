package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

func TestMCPConfigDefaultsAndUpdate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
		MCPEnabled:     false,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetMCPConfig()
	if err != nil {
		t.Fatalf("get mcp config: %v", err)
	}
	if cfg.Enabled {
		t.Fatalf("expected mcp disabled by default")
	}
	if cfg.Endpoint != "/mcp" {
		t.Fatalf("unexpected endpoint: %q", cfg.Endpoint)
	}
	if svc.MCPEnabled() {
		t.Fatalf("MCPEnabled should be false")
	}

	saved, err := svc.UpdateMCPConfig(domain.MCPConfigUpdate{Enabled: true})
	if err != nil {
		t.Fatalf("update mcp: %v", err)
	}
	if !saved.Enabled || !svc.MCPEnabled() {
		t.Fatalf("expected enabled after update: %+v", saved)
	}

	saved, err = svc.UpdateMCPConfig(domain.MCPConfigUpdate{Enabled: false})
	if err != nil {
		t.Fatalf("disable mcp: %v", err)
	}
	if saved.Enabled || svc.MCPEnabled() {
		t.Fatalf("expected disabled after update")
	}
}

func TestSubHDConfigDefaultsAndUpdate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
		SubHDEnabled:   true,
		SubHDBaseURL:   "https://subhd.tv",
		SubHDProxyURL:  "",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetSubHDConfig()
	if err != nil {
		t.Fatalf("get default subhd config: %v", err)
	}
	if !cfg.Enabled {
		t.Fatalf("expected subhd enabled by default")
	}
	if cfg.BaseURL != "https://subhd.tv" {
		t.Fatalf("unexpected base url: %q", cfg.BaseURL)
	}
	if cfg.Proxy != "" {
		t.Fatalf("expected empty proxy, got %q", cfg.Proxy)
	}

	saved, err := svc.UpdateSubHDConfig(domain.SubHDConfigUpdate{
		Enabled: false,
		BaseURL: "https://subhd.me",
		Proxy:   "socks5://127.0.0.1:1080",
	})
	if err != nil {
		t.Fatalf("update subhd config: %v", err)
	}
	if saved.Enabled || saved.BaseURL != "https://subhd.me" || saved.Proxy != "socks5://127.0.0.1:1080" {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
	if svc.SubHDEnabled() {
		t.Fatalf("expected client disabled after update")
	}

	_, err = svc.UpdateSubHDConfig(domain.SubHDConfigUpdate{
		Enabled: true,
		BaseURL: "ftp://bad.example",
		Proxy:   "",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid base url, got %v", err)
	}

	after, err := svc.GetSubHDConfig()
	if err != nil {
		t.Fatalf("get after invalid update: %v", err)
	}
	if after.Enabled || after.BaseURL != "https://subhd.me" {
		t.Fatalf("invalid update should not overwrite config: %+v", after)
	}
}

func TestSonarrConfigDefaultsAndUpdate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot: movieRoot,
		TVMediaRoot:    tvRoot,
		DBPath:         filepath.Join(base, "test.sqlite3"),
		SonarrEnabled:  true,
		SonarrURL:      "http://127.0.0.1:8989",
		SonarrAPIKey:   "env-key",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetSonarrConfig()
	if err != nil {
		t.Fatalf("get default sonarr config: %v", err)
	}
	if !cfg.Enabled {
		t.Fatalf("expected sonarr enabled from env")
	}
	if cfg.URL != "http://127.0.0.1:8989" {
		t.Fatalf("unexpected url: %q", cfg.URL)
	}
	if cfg.APIKey != "" || !cfg.APIKeySet {
		t.Fatalf("api key must be redacted on GET, got key=%q set=%v", cfg.APIKey, cfg.APIKeySet)
	}
	if !svc.SonarrEnabled() {
		t.Fatalf("expected client enabled from env")
	}

	saved, err := svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: true,
		URL:     "http://sonarr.local:8989/",
		APIKey:  "runtime-key",
	})
	if err != nil {
		t.Fatalf("update sonarr config: %v", err)
	}
	if !saved.Enabled || saved.URL != "http://sonarr.local:8989" || saved.APIKey != "" || !saved.APIKeySet {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
	if !svc.SonarrEnabled() {
		t.Fatalf("expected client enabled after update")
	}

	_, err = svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: true,
		URL:     "ftp://bad.example",
		APIKey:  "x",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid url, got %v", err)
	}

	// Empty api key preserves the stored key.
	kept, err := svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: true,
		URL:     "http://sonarr.local:8989",
		APIKey:  "",
	})
	if err != nil {
		t.Fatalf("update with empty api key should keep existing: %v", err)
	}
	if !kept.Enabled || !kept.APIKeySet || kept.APIKey != "" {
		t.Fatalf("expected key preserved (redacted): %+v", kept)
	}
	resolved, err := svc.resolveSonarrConfig()
	if err != nil || resolved.APIKey != "runtime-key" {
		t.Fatalf("stored key should remain runtime-key, got %+v err=%v", resolved, err)
	}

	disabled, err := svc.UpdateSonarrConfig(domain.SonarrConfigUpdate{
		Enabled: false,
		URL:     "http://sonarr.local:8989",
		APIKey:  "runtime-key",
	})
	if err != nil {
		t.Fatalf("disable sonarr: %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("expected disabled config: %+v", disabled)
	}
	if svc.SonarrEnabled() {
		t.Fatalf("expected client disabled after update")
	}

	after, err := svc.GetSonarrConfig()
	if err != nil {
		t.Fatalf("get after disable: %v", err)
	}
	if after.Enabled || after.URL != "http://sonarr.local:8989" || after.APIKey != "" || !after.APIKeySet {
		t.Fatalf("unexpected config after disable: %+v", after)
	}
}

func TestJellyfinConfigDefaultsAndUpdate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
	}

	svc, err := NewService(config.Config{
		MovieMediaRoot:  movieRoot,
		TVMediaRoot:     tvRoot,
		DBPath:          filepath.Join(base, "test.sqlite3"),
		JellyfinEnabled: true,
		JellyfinURL:     "http://127.0.0.1:8096",
		JellyfinAPIKey:  "env-key",
		JellyfinPathMap: "/host/movies:/data/movies",
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	defer func() {
		_ = svc.Close()
	}()

	cfg, err := svc.GetJellyfinConfig()
	if err != nil {
		t.Fatalf("get default jellyfin config: %v", err)
	}
	if !cfg.Enabled {
		t.Fatalf("expected jellyfin enabled from env")
	}
	if cfg.URL != "http://127.0.0.1:8096" {
		t.Fatalf("unexpected url: %q", cfg.URL)
	}
	if cfg.APIKey != "" || !cfg.APIKeySet {
		t.Fatalf("api key must be redacted on GET, got key=%q set=%v", cfg.APIKey, cfg.APIKeySet)
	}
	if cfg.PathMap != "/host/movies:/data/movies" {
		t.Fatalf("unexpected path map: %q", cfg.PathMap)
	}
	if !svc.JellyfinEnabled() {
		t.Fatalf("expected client enabled from env")
	}

	saved, err := svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "http://jellyfin.local:8096/",
		APIKey:  "runtime-key",
		PathMap: "/a:/b,/c:/d",
	})
	if err != nil {
		t.Fatalf("update jellyfin config: %v", err)
	}
	if !saved.Enabled || saved.URL != "http://jellyfin.local:8096" || saved.APIKey != "" || !saved.APIKeySet {
		t.Fatalf("unexpected saved config: %+v", saved)
	}
	if saved.PathMap != "/a:/b,/c:/d" {
		t.Fatalf("unexpected path map: %q", saved.PathMap)
	}
	if !svc.JellyfinEnabled() {
		t.Fatalf("expected client enabled after update")
	}

	_, err = svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "ftp://bad.example",
		APIKey:  "x",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid url, got %v", err)
	}

	// Empty api key preserves the stored key.
	kept, err := svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "http://jellyfin.local:8096",
		APIKey:  "",
		PathMap: "/a:/b,/c:/d",
	})
	if err != nil {
		t.Fatalf("update with empty api key should keep existing: %v", err)
	}
	if !kept.Enabled || !kept.APIKeySet || kept.APIKey != "" {
		t.Fatalf("expected key preserved (redacted): %+v", kept)
	}
	resolved, err := svc.resolveJellyfinConfig()
	if err != nil || resolved.APIKey != "runtime-key" {
		t.Fatalf("stored key should remain runtime-key, got %+v err=%v", resolved, err)
	}

	_, err = svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: true,
		URL:     "http://jellyfin.local:8096",
		APIKey:  "k",
		PathMap: "nocolon",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid path map, got %v", err)
	}

	disabled, err := svc.UpdateJellyfinConfig(domain.JellyfinConfigUpdate{
		Enabled: false,
		URL:     "http://jellyfin.local:8096",
		APIKey:  "runtime-key",
		PathMap: "/a:/b",
	})
	if err != nil {
		t.Fatalf("disable jellyfin: %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("expected disabled config: %+v", disabled)
	}
	if svc.JellyfinEnabled() {
		t.Fatalf("expected client disabled after update")
	}

	after, err := svc.GetJellyfinConfig()
	if err != nil {
		t.Fatalf("get after disable: %v", err)
	}
	if after.Enabled || after.URL != "http://jellyfin.local:8096" || after.APIKey != "" || !after.APIKeySet || after.PathMap != "/a:/b" {
		t.Fatalf("unexpected config after disable: %+v", after)
	}
}

func TestSubtitleConversionConfigDefaultsAndRejectsInvalidTemplate(t *testing.T) {
	base := t.TempDir()
	movieRoot := filepath.Join(base, "movies")
	tvRoot := filepath.Join(base, "tv")
	if err := os.MkdirAll(movieRoot, 0o755); err != nil {
		t.Fatalf("mkdir movie root: %v", err)
	}
	if err := os.MkdirAll(tvRoot, 0o755); err != nil {
		t.Fatalf("mkdir tv root: %v", err)
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

	cfg, err := svc.GetSubtitleConversionConfig()
	if err != nil {
		t.Fatalf("get default conversion config: %v", err)
	}
	if cfg.ASSTemplate != subtitle.DefaultASSTemplate {
		t.Fatalf("expected default ass template")
	}
	if cfg.SourceEncodingDefault != subtitle.DefaultSourceEncoding {
		t.Fatalf("expected default source encoding, got %q", cfg.SourceEncodingDefault)
	}

	customTemplate := strings.Replace(subtitle.DefaultASSTemplate, "Style: Default,Arial,48", "Style: Default,Verdana,46", 1)
	saved, err := svc.UpdateSubtitleConversionConfig(domain.SubtitleConversionConfigUpdate{
		ASSTemplate:           customTemplate,
		SourceEncodingDefault: "gb18030",
	})
	if err != nil {
		t.Fatalf("save conversion config: %v", err)
	}
	if saved.SourceEncodingDefault != "gb18030" {
		t.Fatalf("expected normalized source encoding, got %q", saved.SourceEncodingDefault)
	}

	_, err = svc.UpdateSubtitleConversionConfig(domain.SubtitleConversionConfigUpdate{
		ASSTemplate:           strings.Replace(customTemplate, subtitle.ASSTemplateDialoguesPlaceholder, "", 1),
		SourceEncodingDefault: "utf-8",
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request for invalid template, got %v", err)
	}

	after, err := svc.GetSubtitleConversionConfig()
	if err != nil {
		t.Fatalf("get conversion config after invalid update: %v", err)
	}
	if after.ASSTemplate != strings.TrimSpace(customTemplate) || after.SourceEncodingDefault != "gb18030" {
		t.Fatalf("invalid update should not overwrite config")
	}
}
