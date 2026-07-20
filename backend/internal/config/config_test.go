package config

import (
	"strings"
	"testing"
	"time"
)

func TestParseBoolDefaultTrue(t *testing.T) {
	if !parseBoolDefaultTrue("") || !parseBoolDefaultTrue("true") {
		t.Fatal("empty/true should be true")
	}
	if parseBoolDefaultTrue("false") || parseBoolDefaultTrue("0") || parseBoolDefaultTrue("off") {
		t.Fatal("false-like should be false")
	}
}

func TestParseDurationAndPositiveInt(t *testing.T) {
	if parseDuration("", 3*time.Second) != 3*time.Second {
		t.Fatal("empty duration fallback")
	}
	if parseDuration("5s", 3*time.Second) != 5*time.Second {
		t.Fatal("parse 5s")
	}
	if parseDuration("nope", 3*time.Second) != 3*time.Second {
		t.Fatal("invalid duration fallback")
	}
	if parsePositiveInt("", 1) != 1 || parsePositiveInt("3", 1) != 3 {
		t.Fatal("positive int")
	}
	if parsePositiveInt("0", 2) != 2 || parsePositiveInt("x", 2) != 2 {
		t.Fatal("invalid positive int fallback")
	}
	if parseNonNegativeInt("", 300) != 300 {
		t.Fatal("empty non-negative int fallback")
	}
	if parseNonNegativeInt("0", 300) != 0 {
		t.Fatal("0 should be allowed for unlimited")
	}
	if parseNonNegativeInt("300", 60) != 300 {
		t.Fatal("parse 300 seconds")
	}
	if parseNonNegativeInt("x", 300) != 300 {
		t.Fatal("invalid non-negative int fallback")
	}
}

func TestSplitOrigins(t *testing.T) {
	got := splitOrigins(" http://a.com , ,https://b.com ")
	if len(got) != 2 || got[0] != "http://a.com" || got[1] != "https://b.com" {
		t.Fatalf("got %#v", got)
	}
	if splitOrigins("  ") != nil {
		t.Fatal("blank should be nil")
	}
}

func TestRedactDatabaseURL(t *testing.T) {
	got := RedactDatabaseURL("postgres://user:secret@localhost:5432/db?sslmode=disable")
	if got == "" || strings.Contains(got, "secret") {
		t.Fatalf("expected password redacted, got %q", got)
	}
	if !strings.Contains(got, "xxxxx") {
		t.Fatalf("expected xxxxx placeholder, got %q", got)
	}
	if RedactDatabaseURL("") != "" {
		t.Fatal("empty")
	}
}

func TestIsProduction(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("ENV", "")
	if IsProduction() {
		t.Fatal("empty env should not be production")
	}
	t.Setenv("APP_ENV", "production")
	if !IsProduction() {
		t.Fatal("APP_ENV=production")
	}
	t.Setenv("APP_ENV", "")
	t.Setenv("ENV", "prod")
	if !IsProduction() {
		t.Fatal("ENV=prod")
	}
}

func TestValidateDefaultAdminTokenInProduction(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("ADMIN_TOKEN", "")
	t.Setenv("MEDIA_ROOT", "")
	t.Setenv("MOVIE_MEDIA_ROOT", t.TempDir())
	t.Setenv("TV_MEDIA_ROOT", t.TempDir())
	cfg := Load()
	if !cfg.AdminTokenIsDefault {
		t.Fatal("expected default token")
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected validation error in production")
	}

	t.Setenv("APP_ENV", "development")
	cfg = Load()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("dev should allow default: %v", err)
	}

	t.Setenv("APP_ENV", "production")
	t.Setenv("ADMIN_TOKEN", "super-secret-token")
	cfg = Load()
	if cfg.AdminTokenIsDefault {
		t.Fatal("custom token should not be marked default")
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("production with strong token: %v", err)
	}
}

func TestLoadLegacyMediaRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APP_ENV", "development")
	t.Setenv("ADMIN_TOKEN", "token")
	t.Setenv("MEDIA_ROOT", root)
	t.Setenv("MOVIE_MEDIA_ROOT", "")
	t.Setenv("TV_MEDIA_ROOT", "")
	cfg := Load()
	if cfg.MovieMediaRoot != cfg.TVMediaRoot {
		t.Fatalf("legacy MEDIA_ROOT should set both roots equal: movie=%q tv=%q", cfg.MovieMediaRoot, cfg.TVMediaRoot)
	}
}

func TestLoadExplicitChangeMeIsDefault(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("ADMIN_TOKEN", DefaultAdminToken)
	cfg := Load()
	if !cfg.AdminTokenIsDefault {
		t.Fatal("explicit change-me should still count as insecure default")
	}
}
