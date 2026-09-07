package secretcrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
)

const prefix = "enc:v1:"

// Encrypt seals plaintext with AES-GCM keyed by SHA-256(secret).
// Empty plaintext is stored as-is. Already-prefixed values are returned unchanged.
func Encrypt(secret, plaintext string) (string, error) {
	plaintext = strings.TrimSpace(plaintext)
	if plaintext == "" || IsEncrypted(plaintext) {
		return plaintext, nil
	}
	key := deriveKey(secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return prefix + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// Decrypt opens an enc:v1: value. Plaintext (legacy) values pass through.
func Decrypt(secret, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !IsEncrypted(value) {
		return value, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return "", fmt.Errorf("decode secret: %w", err)
	}
	key := deriveKey(secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	plain, err := gcm.Open(nil, raw[:nonceSize], raw[nonceSize:], nil)
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}
	return string(plain), nil
}

func IsEncrypted(value string) bool {
	return strings.HasPrefix(strings.TrimSpace(value), prefix)
}

func deriveKey(secret string) []byte {
	sum := sha256.Sum256([]byte("subtitle-ui-settings-v1|" + secret))
	return sum[:]
}
