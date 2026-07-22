package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/jellyfin"
)

// GetJellyfinConfig returns effective Jellyfin settings (DB overrides env).
func (s *Service) GetJellyfinConfig() (domain.JellyfinConfig, error) {
	return s.resolveJellyfinConfig()
}

// UpdateJellyfinConfig persists Jellyfin settings and hot-reloads the client.
func (s *Service) UpdateJellyfinConfig(req domain.JellyfinConfigUpdate) (domain.JellyfinConfig, error) {
	baseURL := strings.TrimSpace(req.URL)
	apiKey := strings.TrimSpace(req.APIKey)
	pathMapRaw := strings.TrimSpace(req.PathMap)

	var normalizedURL string
	if baseURL != "" {
		normalized, err := jellyfin.NormalizeBaseURL(baseURL)
		if err != nil {
			return domain.JellyfinConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
		}
		normalizedURL = normalized
	}

	pathMaps, err := jellyfin.ParsePathMaps(pathMapRaw)
	if err != nil {
		return domain.JellyfinConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	pathMapStored := jellyfin.FormatPathMaps(pathMaps)

	if req.Enabled {
		if normalizedURL == "" {
			return domain.JellyfinConfig{}, fmt.Errorf("%w: jellyfin url is required when enabled", ErrBadRequest)
		}
		if apiKey == "" {
			return domain.JellyfinConfig{}, fmt.Errorf("%w: jellyfin api key is required when enabled", ErrBadRequest)
		}
	}

	enabledValue := "false"
	if req.Enabled {
		enabledValue = "true"
	}
	updatedAt := time.Now().UTC()
	if err := s.store.SetAppSettings(map[string]string{
		settingJellyfinEnabled: enabledValue,
		settingJellyfinURL:     normalizedURL,
		settingJellyfinAPIKey:  apiKey,
		settingJellyfinPathMap: pathMapStored,
	}, updatedAt); err != nil {
		s.recordOp("config_jellyfin", systemOperationVideoID, "", "", "error", err.Error())
		return domain.JellyfinConfig{}, err
	}

	s.rebuildJellyfinClient(req.Enabled, normalizedURL, apiKey, pathMaps)

	apiKeyState := "cleared"
	if apiKey != "" {
		apiKeyState = "set"
	}
	s.recordOp(
		"config_jellyfin",
		systemOperationVideoID,
		"",
		"",
		"ok",
		fmt.Sprintf("enabled=%s url=%s api_key=%s path_map=%q", enabledValue, normalizedURL, apiKeyState, pathMapStored),
	)

	return domain.JellyfinConfig{
		Enabled:   req.Enabled && normalizedURL != "" && apiKey != "",
		URL:       normalizedURL,
		APIKey:    apiKey,
		PathMap:   pathMapStored,
		UpdatedAt: updatedAt,
	}, nil
}

// applyStoredJellyfinConfig reloads DB overrides onto the Jellyfin client (startup).
func (s *Service) applyStoredJellyfinConfig() error {
	cfg, err := s.resolveJellyfinConfig()
	if err != nil {
		return err
	}
	maps, err := jellyfin.ParsePathMaps(cfg.PathMap)
	if err != nil {
		// Keep going with empty maps if stored value is corrupt.
		maps = nil
	}
	s.rebuildJellyfinClient(cfg.Enabled, cfg.URL, cfg.APIKey, maps)
	return nil
}

func (s *Service) resolveJellyfinConfig() (domain.JellyfinConfig, error) {
	settings, err := s.store.GetAppSettings([]string{
		settingJellyfinEnabled,
		settingJellyfinURL,
		settingJellyfinAPIKey,
		settingJellyfinPathMap,
	})
	if err != nil {
		return domain.JellyfinConfig{}, err
	}

	enabled := s.cfg.JellyfinEnabled
	baseURL := strings.TrimSpace(s.cfg.JellyfinURL)
	if baseURL != "" {
		if normalized, err := jellyfin.NormalizeBaseURL(baseURL); err == nil {
			baseURL = normalized
		} else {
			baseURL = strings.TrimRight(baseURL, "/")
		}
	}
	apiKey := strings.TrimSpace(s.cfg.JellyfinAPIKey)
	pathMap := strings.TrimSpace(s.cfg.JellyfinPathMap)
	updatedAt := time.Time{}

	if setting, ok := settings[settingJellyfinEnabled]; ok {
		enabled = parseStoredBool(setting.Value, enabled)
		updatedAt = setting.UpdatedAt
	}
	if setting, ok := settings[settingJellyfinURL]; ok {
		trimmed := strings.TrimSpace(setting.Value)
		if trimmed == "" {
			baseURL = ""
		} else if normalized, err := jellyfin.NormalizeBaseURL(trimmed); err == nil {
			baseURL = normalized
		}
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}
	if setting, ok := settings[settingJellyfinAPIKey]; ok {
		apiKey = strings.TrimSpace(setting.Value)
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}
	if setting, ok := settings[settingJellyfinPathMap]; ok {
		pathMap = strings.TrimSpace(setting.Value)
		if setting.UpdatedAt.After(updatedAt) {
			updatedAt = setting.UpdatedAt
		}
	}

	if maps, err := jellyfin.ParsePathMaps(pathMap); err == nil {
		pathMap = jellyfin.FormatPathMaps(maps)
	}

	effectiveEnabled := enabled && baseURL != "" && apiKey != ""

	return domain.JellyfinConfig{
		Enabled:   effectiveEnabled,
		URL:       baseURL,
		APIKey:    apiKey,
		PathMap:   pathMap,
		UpdatedAt: updatedAt,
	}, nil
}

func (s *Service) rebuildJellyfinClient(enabled bool, baseURL, apiKey string, pathMaps []jellyfin.PathMap) {
	client := jellyfin.New(jellyfin.Options{
		Enabled:  enabled,
		BaseURL:  baseURL,
		APIKey:   apiKey,
		UserID:   strings.TrimSpace(s.cfg.JellyfinUserID),
		PathMaps: pathMaps,
	})
	s.jellyfinMu.Lock()
	s.jellyfin = client
	s.jellyfinMu.Unlock()
}

func (s *Service) jellyfinClient() *jellyfin.Client {
	s.jellyfinMu.RLock()
	defer s.jellyfinMu.RUnlock()
	return s.jellyfin
}

// JellyfinEnabled reports whether Jellyfin integration is configured on.
func (s *Service) JellyfinEnabled() bool {
	c := s.jellyfinClient()
	return c != nil && c.Enabled()
}

// TestJellyfinConfig probes connectivity with the provided draft settings (does not save).
func (s *Service) TestJellyfinConfig(ctx context.Context, req domain.JellyfinConfigUpdate) (domain.ConnectionTestResult, error) {
	baseURL := strings.TrimSpace(req.URL)
	apiKey := strings.TrimSpace(req.APIKey)
	pathMapRaw := strings.TrimSpace(req.PathMap)
	if baseURL == "" {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: jellyfin url is required", ErrBadRequest)
	}
	if apiKey == "" {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: jellyfin api key is required", ErrBadRequest)
	}
	normalized, err := jellyfin.NormalizeBaseURL(baseURL)
	if err != nil {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	pathMaps, err := jellyfin.ParsePathMaps(pathMapRaw)
	if err != nil {
		return domain.ConnectionTestResult{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	client := jellyfin.New(jellyfin.Options{
		Enabled:  true,
		BaseURL:  normalized,
		APIKey:   apiKey,
		UserID:   strings.TrimSpace(s.cfg.JellyfinUserID),
		PathMaps: pathMaps,
	})
	if err := client.Ping(ctx); err != nil {
		s.recordOp("config_jellyfin_test", systemOperationVideoID, normalized, "", "error", err.Error())
		return domain.ConnectionTestResult{
			OK:      false,
			Message: err.Error(),
		}, nil
	}
	if len(pathMaps) > 0 {
		if err := client.ValidatePathMaps(ctx); err != nil {
			s.recordOp("config_jellyfin_test", systemOperationVideoID, normalized, "", "error", err.Error())
			return domain.ConnectionTestResult{
				OK:      false,
				Message: err.Error(),
			}, nil
		}
		msg := fmt.Sprintf("ok; path map verified (%d)", len(pathMaps))
		s.recordOp("config_jellyfin_test", systemOperationVideoID, normalized, "", "ok", msg)
		return domain.ConnectionTestResult{
			OK:      true,
			Message: msg,
		}, nil
	}
	s.recordOp("config_jellyfin_test", systemOperationVideoID, normalized, "", "ok", "ping ok")
	return domain.ConnectionTestResult{
		OK:      true,
		Message: "ok",
	}, nil
}
