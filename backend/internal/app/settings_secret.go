package app

import (
	"fmt"
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

func (s *Service) sealSetting(value string) (string, error) {
	if s == nil {
		return "", fmt.Errorf("encrypt setting: service is not initialized")
	}
	enc, err := secretcrypt.Encrypt(s.sealKey(), value)
	if err != nil {
		return "", fmt.Errorf("encrypt setting: %w", err)
	}
	return enc, nil
}

func (s *Service) openSettingSecret(value string) openedSetting {
	value = strings.TrimSpace(value)
	if value == "" {
		return openedSetting{}
	}
	if !secretcrypt.IsEncrypted(value) {
		return openedSetting{Plain: value, Raw: value, Set: true, DecryptOK: true}
	}
	for _, key := range s.openKeys() {
		plain, err := secretcrypt.Decrypt(key, value)
		if err != nil {
			continue
		}
		return openedSetting{Plain: strings.TrimSpace(plain), Raw: value, Set: true, DecryptOK: true}
	}
	log.Printf("decrypt setting failed: no matching settings secret")
	return openedSetting{Raw: value, Set: true}
}

func (s *Service) sealKey() string {
	if s == nil {
		return ""
	}
	if secret := strings.TrimSpace(s.cfg.SettingsSecret); secret != "" {
		return secret
	}
	return strings.TrimSpace(s.cfg.AdminToken)
}

func (s *Service) openKeys() []string {
	if s == nil {
		return nil
	}
	keys := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	add := func(key string) {
		key = strings.TrimSpace(key)
		if key == "" {
			return
		}
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	add(s.cfg.SettingsSecret)
	add(s.cfg.AdminToken)
	if len(keys) == 0 {
		// Match sealKey() when neither SETTINGS_SECRET nor ADMIN_TOKEN is set (tests).
		keys = append(keys, "")
	}
	return keys
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

func (s *Service) keepOrSealAPIKey(incoming, existingPlain, existingRaw string) (stored, plain string, set bool, err error) {
	incoming = strings.TrimSpace(incoming)
	if incoming != "" {
		stored, err = s.sealSetting(incoming)
		if err != nil {
			return "", "", false, err
		}
		return stored, incoming, true, nil
	}
	existingPlain = strings.TrimSpace(existingPlain)
	if existingPlain != "" {
		stored, err = s.sealSetting(existingPlain)
		if err != nil {
			return "", "", false, err
		}
		return stored, existingPlain, true, nil
	}
	existingRaw = strings.TrimSpace(existingRaw)
	if secretcrypt.IsEncrypted(existingRaw) {
		return existingRaw, "", true, nil
	}
	return "", "", false, nil
}
