package secretcrypt

import "testing"

func TestEncryptDecryptRoundTrip(t *testing.T) {
	enc, err := Encrypt("admin-token", "jellyfin-key")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !IsEncrypted(enc) {
		t.Fatalf("expected encrypted prefix, got %q", enc)
	}
	got, err := Decrypt("admin-token", enc)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != "jellyfin-key" {
		t.Fatalf("got %q", got)
	}
	if _, err := Decrypt("other", enc); err == nil {
		t.Fatal("wrong secret should fail")
	}
}

func TestDecryptLegacyPlaintext(t *testing.T) {
	got, err := Decrypt("secret", "plain-key")
	if err != nil || got != "plain-key" {
		t.Fatalf("legacy: %q %v", got, err)
	}
	enc, err := Encrypt("secret", "")
	if err != nil || enc != "" {
		t.Fatalf("empty: %q %v", enc, err)
	}
}
