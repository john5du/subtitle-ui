package app

import (
	"log"
	"strings"

	"subtitle-ui/backend/internal/secretcrypt"
)

type openedSetting struct {
	Plain     string
	Raw       string
	Set       bool
	DecryptOK bool
}

func (s *Service) sealSetting(value string) string {
	if s == nil {
		return value
	}
	enc, err := secretcrypt.Encrypt(s.cfg.AdminToken, value)
	if err != nil {
		log.Printf("encrypt setting failed: %v", err)
		return value
	}
	return enc
}

func (s *Service) openSettingSecret(value string) openedSetting {
	value = strings.TrimSpace(value)
	if value == "" {
		return openedSetting{}
	}
	if !secretcrypt.IsEncrypted(value) {
		return openedSetting{Plain: value, Raw: value, Set: true, DecryptOK: true}
	}
	if s == nil {
		return openedSetting{Raw: value, Set: true}
	}
	plain, err := secretcrypt.Decrypt(s.cfg.AdminToken, value)
	if err != nil {
		log.Printf("decrypt setting failed: %v", err)
		return openedSetting{Raw: value, Set: true}
	}
	return openedSetting{Plain: strings.TrimSpace(plain), Raw: value, Set: true, DecryptOK: true}
}

func (s *Service) rawAppSetting(key string) string {
	if s == nil || s.store == nil {
		return ""
	}
	settings, err := s.store.GetAppSettings([]string{key})
	if err != nil {
		return ""
	}
	setting, ok := settings[key]
	if !ok {
		return ""
	}
	return strings.TrimSpace(setting.Value)
}

func (s *Service) keepOrSealAPIKey(incoming, existingPlain, existingRaw string) (stored, plain string, set bool) {
	incoming = strings.TrimSpace(incoming)
	if incoming != "" {
		return s.sealSetting(incoming), incoming, true
	}
	existingPlain = strings.TrimSpace(existingPlain)
	if existingPlain != "" {
		return s.sealSetting(existingPlain), existingPlain, true
	}
	existingRaw = strings.TrimSpace(existingRaw)
	if secretcrypt.IsEncrypted(existingRaw) {
		return existingRaw, "", true
	}
	return "", "", false
}
