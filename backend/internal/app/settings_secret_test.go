package app

import (
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

	stored, plain, set := svc.keepOrSealAPIKey("", "", enc)
	if stored != enc || plain != "" || !set {
		t.Fatalf("empty incoming must not wipe ciphertext, stored=%q plain=%q set=%v", stored, plain, set)
	}

	stored, plain, set = svc.keepOrSealAPIKey("", "runtime-key", enc)
	if plain != "runtime-key" || !set || stored == "" || stored == enc {
		t.Fatalf("usable plaintext should be re-sealed, stored=%q plain=%q set=%v", stored, plain, set)
	}
}
