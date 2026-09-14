package app

import (
	"fmt"
	"strings"
	"time"

	"subtitle-ui/backend/internal/config"
	"subtitle-ui/backend/internal/domain"
)

// GetScanConfig returns effective automatic scan settings (DB overrides env).
func (s *Service) GetScanConfig() (domain.ScanConfig, error) {
	return s.resolveScanConfig()
}

// UpdateScanConfig persists automatic scan settings and hot-reloads the ticker.
func (s *Service) UpdateScanConfig(req domain.ScanConfigUpdate) (domain.ScanConfig, error) {
	_, canonical, err := parseScanInterval(req.Interval)
	if err != nil {
		return domain.ScanConfig{}, err
	}
	enabledValue := "false"
	if req.Enabled {
		enabledValue = "true"
	}
	updatedAt := time.Now().UTC()
	if err := s.store.SetAppSettings(map[string]string{
		settingScanAutoEnabled: enabledValue,
		settingScanInterval:    canonical,
	}, updatedAt); err != nil {
		s.recordOp("config_scan", systemOperationVideoID, "", "", "error", err.Error())
		return domain.ScanConfig{}, err
	}

	s.reloadScanScheduler()
	s.recordOp(
		"config_scan",
		systemOperationVideoID,
		"",
		"",
		"ok",
		fmt.Sprintf("enabled=%s interval=%s", enabledValue, canonical),
	)

	return domain.ScanConfig{
		Enabled:   req.Enabled,
		Interval:  canonical,
		UpdatedAt: updatedAt,
	}, nil
}

func (s *Service) resolveScanConfig() (domain.ScanConfig, error) {
	settings, err := s.store.GetAppSettings([]string{settingScanAutoEnabled, settingScanInterval})
	if err != nil {
		return domain.ScanConfig{}, err
	}

	enabled := s.cfg.ScanAutoEnabled
	interval := s.cfg.ScanInterval
	if interval <= 0 {
		interval = config.DefaultScanInterval
	}
	updatedAt := time.Time{}

	if setting, ok := settings[settingScanAutoEnabled]; ok {
		enabled = parseStoredBool(setting.Value, enabled)
		updatedAt = setting.UpdatedAt
	}
	if setting, ok := settings[settingScanInterval]; ok {
		if d, _, parseErr := parseScanInterval(setting.Value); parseErr == nil {
			interval = d
			if setting.UpdatedAt.After(updatedAt) {
				updatedAt = setting.UpdatedAt
			}
		}
	}

	return domain.ScanConfig{
		Enabled:   enabled,
		Interval:  formatScanInterval(interval),
		UpdatedAt: updatedAt,
	}, nil
}

func parseScanInterval(raw string) (time.Duration, string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, "", fmt.Errorf("%w: scan interval is required", ErrBadRequest)
	}
	d, err := time.ParseDuration(trimmed)
	if err != nil {
		return 0, "", fmt.Errorf("%w: invalid scan interval", ErrBadRequest)
	}
	if d < config.MinScanInterval {
		return 0, "", fmt.Errorf("%w: scan interval must be at least %s", ErrBadRequest, config.MinScanInterval)
	}
	if d > config.MaxScanInterval {
		return 0, "", fmt.Errorf("%w: scan interval must be at most %s", ErrBadRequest, config.MaxScanInterval)
	}
	return d, formatScanInterval(d), nil
}

func formatScanInterval(d time.Duration) string {
	if d <= 0 {
		d = config.DefaultScanInterval
	}
	if d%time.Hour == 0 {
		return fmt.Sprintf("%dh", int64(d/time.Hour))
	}
	if d%time.Minute == 0 {
		return fmt.Sprintf("%dm", int64(d/time.Minute))
	}
	return d.String()
}
