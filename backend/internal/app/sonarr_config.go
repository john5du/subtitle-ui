package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/sonarr"
)

// GetSonarrConfig returns effective Sonarr settings (DB overrides env).
// API keys are never returned in full; use APIKeySet to detect presence.
func (s *Service) GetSonarrConfig() (domain.SonarrConfig, error) {
	cfg, err := s.resolveSonarrConfig()
	if err != nil {
		return domain.SonarrConfig{}, err
	}
	return redactSonarrConfig(cfg), nil
}

// UpdateSonarrConfig persists Sonarr settings and hot-reloads the client.
// Empty APIKey keeps the previously stored key (so masked GET + save without retyping works).
func (s *Service) UpdateSonarrConfig(req domain.SonarrConfigUpdate) (domain.SonarrConfig, error) {
	baseURL := strings.TrimSpace(req.URL)
	apiKey := strings.TrimSpace(req.APIKey)

	var normalizedURL string
	if baseURL != "" {
		normalized, err := sonarr.NormalizeBaseURL(baseURL)
		if err != nil {
			return domain.SonarrConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
		}
		normalizedURL = normalized
	}

	existing, err := s.resolveSonarrConfig()
	if err != nil {
		return domain.SonarrConfig{}, err
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(existing.APIKey)
	}

	if req.Enabled {
		if normalizedURL == "" {
			return domain.SonarrConfig{}, fmt.Errorf("%w: sonarr url is required when enabled", ErrBadRequest)
		}
		if apiKey == "" {
			return domain.SonarrConfig{}, fmt.Errorf("%w: sonarr api key is required when enabled", ErrBadRequest)
		}
	}

	enabledValue := "false"
	if req.Enabled {
		enabledValue = "true"
	}
	updatedAt := time.Now().UTC()
	if err := s.store.SetAppSettings(map[string]string{
		settingSonarrEnabled: enabledValue,
		settingSonarrURL:     normalizedURL,
		settingSonarrAPIKey:  apiKey,
	}, updatedAt); err != nil {
		s.recordOp("config_sonarr", systemOperationVideoID, "", "", "error", err.Error())
		return domain.SonarrConfig{}, err
	}

	s.rebuildSonarrClient(req.Enabled, normalizedURL, apiKey)

	apiKeyState := "cleared"
	if apiKey != "" {
		apiKeyState = "set"
	}
	s.recordOp(
		"config_sonarr",
		systemOperationVideoID,
		"",
		"",
		"ok",
		fmt.Sprintf("enabled=%s url=%s api_key=%s", enabledValue, normalizedURL, apiKeyState),
	)

	return redactSonarrConfig(domain.SonarrConfig{
		Enabled:   req.Enabled && normalizedURL != "" && apiKey != "",
		URL:       normalizedURL,
		APIKey:    apiKey,
		UpdatedAt: updatedAt,
	}), nil
}

func redactSonarrConfig(cfg domain.SonarrConfig) domain.SonarrConfig {
	cfg.APIKeySet = strings.TrimSpace(cfg.APIKey) != ""
	cfg.APIKey = ""
	return cfg
}

// applyStoredSonarrConfig reloads DB overrides onto the Sonarr client (startup).
func (s *Service) applyStoredSonarrConfig() error {
	cfg, err := s.resolveSonarrConfig()
	if err != nil {
		return err
	}
	s.rebuildSonarrClient(cfg.Enabled, cfg.URL, cfg.APIKey)
	return nil
}

func (s *Service) resolveSonarrConfig() (domain.SonarrConfig, error) {
	settings, err := s.store.GetAppSettings([]string{
		settingSonarrEnabled,
		settingSonarrURL,
		settingSonarrAPIKey,
	})
	if err != nil {
		return domain.SonarrConfig{}, err
	}

	enabled := s.cfg.SonarrEnabled
	baseURL := strings.TrimSpace(s.cfg.SonarrURL)
	if baseURL != "" {
		if normalized, err := sonarr.NormalizeBaseURL(baseURL); err == nil {
			baseURL = normalized
		} else {
			baseURL = strings.TrimRight(baseURL, "/")
		}
	}
	apiKey := strings.TrimSpace(s.cfg.SonarrAPIKey)
	updatedAt := time.Time{}

	if setting, ok := settings[settingSonarrEnabled]; ok {
		enabled = parseStoredBool(setting.Value, enabled)
		updatedAt = setting.UpdatedAt
	}
	if setting, ok := settings[settingSonarrURL]; ok {
		// Key present: use stored value (may be empty = clear URL).
		trimmed := strings.TrimSpace(setting.Value)
		if trimmed == "" {
			baseURL = ""
		} else if normalized, err := sonarr.NormalizeBaseURL(trimmed); err == nil {
			baseURL = normalized
		}
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}
	if setting, ok := settings[settingSonarrAPIKey]; ok {
		apiKey = strings.TrimSpace(setting.Value)
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}

	// Effective enable requires URL+key (same as env bootstrap).
	effectiveEnabled := enabled && baseURL != "" && apiKey != ""

	return domain.SonarrConfig{
		Enabled:   effectiveEnabled,
		URL:       baseURL,
		APIKey:    apiKey,
		UpdatedAt: updatedAt,
	}, nil
}

func (s *Service) rebuildSonarrClient(enabled bool, baseURL, apiKey string) {
	client := sonarr.New(sonarr.Options{
		Enabled: enabled,
		BaseURL: baseURL,
		APIKey:  apiKey,
	})
	s.sonarrMu.Lock()
	s.sonarr = client
	s.sonarrMu.Unlock()
}

// TestSonarrConfig probes connectivity with the provided draft settings (does not save).
// Empty APIKey reuses the stored key so the settings UI can test without retyping a masked secret.
func (s *Service) TestSonarrConfig(ctx context.Context, req domain.SonarrConfigUpdate) (domain.ConnectionTestResult, error) {
	baseURL := strings.TrimSpace(req.URL)
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		if existing, err := s.resolveSonarrConfig(); err == nil {
			apiKey = strings.TrimSpace(existing.APIKey)
		}
	}
	if baseURL == "" {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: sonarr url is required", ErrBadRequest)
	}
	if apiKey == "" {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: sonarr api key is required", ErrBadRequest)
	}
	normalized, err := sonarr.NormalizeBaseURL(baseURL)
	if err != nil {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	client := sonarr.New(sonarr.Options{
		Enabled: true,
		BaseURL: normalized,
		APIKey:  apiKey,
	})
	if err := client.Ping(ctx); err != nil {
		s.recordOp("config_sonarr_test", systemOperationVideoID, normalized, "", "error", err.Error())
		return domain.ConnectionTestResult{
			OK:      false,
			Message: err.Error(),
		}, nil
	}
	s.recordOp("config_sonarr_test", systemOperationVideoID, normalized, "", "ok", "ping ok")
	return domain.ConnectionTestResult{
		OK:      true,
		Message: "ok",
	}, nil
}
