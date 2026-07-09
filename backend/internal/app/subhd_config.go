package app

import (
	"fmt"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/subhd"
)

// GetSubHDConfig returns effective SubHD settings (DB overrides env).
func (s *Service) GetSubHDConfig() (domain.SubHDConfig, error) {
	return s.resolveSubHDConfig()
}

// UpdateSubHDConfig persists SubHD settings and hot-reloads the client.
func (s *Service) UpdateSubHDConfig(req domain.SubHDConfigUpdate) (domain.SubHDConfig, error) {
	baseURL := strings.TrimSpace(req.BaseURL)
	if baseURL == "" {
		baseURL = s.envSubHDBaseURL()
	}
	normalizedBase, err := subhd.NormalizeBaseURL(baseURL)
	if err != nil {
		return domain.SubHDConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	normalizedProxy, err := subhd.NormalizeProxyURL(req.Proxy)
	if err != nil {
		return domain.SubHDConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	enabledValue := "false"
	if req.Enabled {
		enabledValue = "true"
	}
	updatedAt := time.Now().UTC()
	if err := s.store.SetAppSettings(map[string]string{
		settingSubHDEnabled: enabledValue,
		settingSubHDBaseURL: normalizedBase,
		settingSubHDProxy:   normalizedProxy,
	}, updatedAt); err != nil {
		return domain.SubHDConfig{}, err
	}

	s.rebuildSubHDClient(req.Enabled, normalizedBase, normalizedProxy)

	return domain.SubHDConfig{
		Enabled:        req.Enabled,
		BaseURL:        normalizedBase,
		Proxy:          normalizedProxy,
		DefaultBaseURL: s.envSubHDBaseURL(),
		UpdatedAt:      updatedAt,
	}, nil
}

// applyStoredSubHDConfig reloads DB overrides onto the SubHD client (startup).
func (s *Service) applyStoredSubHDConfig() error {
	cfg, err := s.resolveSubHDConfig()
	if err != nil {
		return err
	}
	s.rebuildSubHDClient(cfg.Enabled, cfg.BaseURL, cfg.Proxy)
	return nil
}

func (s *Service) resolveSubHDConfig() (domain.SubHDConfig, error) {
	settings, err := s.store.GetAppSettings([]string{
		settingSubHDEnabled,
		settingSubHDBaseURL,
		settingSubHDProxy,
	})
	if err != nil {
		return domain.SubHDConfig{}, err
	}

	enabled := s.cfg.SubHDEnabled
	baseURL := s.envSubHDBaseURL()
	proxy := strings.TrimSpace(s.cfg.SubHDProxyURL)
	updatedAt := time.Time{}

	if setting, ok := settings[settingSubHDEnabled]; ok {
		enabled = parseStoredBool(setting.Value, enabled)
		updatedAt = setting.UpdatedAt
	}
	if setting, ok := settings[settingSubHDBaseURL]; ok {
		if trimmed := strings.TrimSpace(setting.Value); trimmed != "" {
			if normalized, err := subhd.NormalizeBaseURL(trimmed); err == nil {
				baseURL = normalized
			}
		}
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}
	if setting, ok := settings[settingSubHDProxy]; ok {
		// Key present: use stored value (may be empty = no proxy).
		if normalized, err := subhd.NormalizeProxyURL(setting.Value); err == nil {
			proxy = normalized
		}
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}

	return domain.SubHDConfig{
		Enabled:        enabled,
		BaseURL:        baseURL,
		Proxy:          proxy,
		DefaultBaseURL: s.envSubHDBaseURL(),
		UpdatedAt:      updatedAt,
	}, nil
}

func (s *Service) envSubHDBaseURL() string {
	base := strings.TrimSpace(s.cfg.SubHDBaseURL)
	if base == "" {
		return defaultSubHDBaseURL
	}
	if normalized, err := subhd.NormalizeBaseURL(base); err == nil {
		return normalized
	}
	return strings.TrimRight(base, "/")
}

func parseStoredBool(raw string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
