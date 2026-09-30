package app

import (
	"strings"
	"testing"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/secretcrypt"
)

func TestOpenSettingSecretDecryptFailureIsNotEmpty(t *testing.T) {
	svc := &Service{cfg: config.Config{AdminToken: "token-a"}}
	enc, err := secretcrypt.Encrypt("token-a", "runtime-key")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	opened := svc.openSettingSecret(enc)
	if !opened.DecryptOK || opened.Plain != "runtime-key" || !opened.Set {
		t.Fatalf("expected decrypted secret, got %+v", opened)
	}

	svc.cfg.AdminToken = "token-b"
	opened = svc.openSettingSecret(enc)
	if opened.DecryptOK || opened.Plain != "" || !opened.Set || opened.Raw != enc {
		t.Fatalf("decrypt failure must keep ciphertext, got %+v", opened)
	}

	stored, plain, set, err := svc.keepOrSealAPIKey("", "", enc)
	if err != nil {
		t.Fatalf("keep ciphertext: %v", err)
	}
	if stored != enc || plain != "" || !set {
		t.Fatalf("empty incoming must not wipe ciphertext, stored=%q plain=%q set=%v", stored, plain, set)
	}

	stored, plain, set, err = svc.keepOrSealAPIKey("", "runtime-key", enc)
	if err != nil {
		t.Fatalf("re-seal: %v", err)
	}
	if plain != "runtime-key" || !set || stored == "" || stored == enc {
		t.Fatalf("usable plaintext should be re-sealed, stored=%q plain=%q set=%v", stored, plain, set)
	}
}

func TestSealSettingUsesSettingsSecretAndFallsBackToAdminToken(t *testing.T) {
	svc := &Service{cfg: config.Config{AdminToken: "token-a", SettingsSecret: "settings-b"}}
	legacy, err := secretcrypt.Encrypt("token-a", "legacy-key")
	if err != nil {
		t.Fatalf("encrypt legacy: %v", err)
	}
	opened := svc.openSettingSecret(legacy)
	if !opened.DecryptOK || opened.Plain != "legacy-key" {
		t.Fatalf("admin-token ciphertext must still decrypt, got %+v", opened)
	}

	sealed, err := svc.sealSetting("new-key")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if !secretcrypt.IsEncrypted(sealed) {
		t.Fatalf("expected ciphertext, got %q", sealed)
	}
	if got, err := secretcrypt.Decrypt("settings-b", sealed); err != nil || got != "new-key" {
		t.Fatalf("expected SETTINGS_SECRET decrypt, got %q err=%v", got, err)
	}
	if _, err := secretcrypt.Decrypt("token-a", sealed); err == nil {
		t.Fatal("new ciphertext must not decrypt with ADMIN_TOKEN")
	}
}

func TestSealSettingRoundTripWithEmptyAdminToken(t *testing.T) {
	svc := &Service{cfg: config.Config{}}
	sealed, err := svc.sealSetting("runtime-key")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	opened := svc.openSettingSecret(sealed)
	if !opened.DecryptOK || opened.Plain != "runtime-key" {
		t.Fatalf("empty-token ciphertext must decrypt, got %+v", opened)
	}
}

func TestSealSettingDoesNotStorePlaintextOnFailure(t *testing.T) {
	var svc *Service
	if _, err := svc.sealSetting("runtime-key"); err == nil {
		t.Fatal("nil service must fail closed")
	} else if !strings.Contains(err.Error(), "encrypt setting") {
		t.Fatalf("unexpected error: %v", err)
	}
}
