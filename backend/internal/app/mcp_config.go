package app

import (
	"fmt"
	"time"

	"subtitle-ui/backend/internal/domain"
)

const mcpEndpointPath = "/mcp"

// GetMCPConfig returns effective MCP settings (DB overrides env).
func (s *Service) GetMCPConfig() (domain.MCPConfig, error) {
	return s.resolveMCPConfig()
}

// UpdateMCPConfig persists MCP enabled flag and hot-reloads the gate.
func (s *Service) UpdateMCPConfig(req domain.MCPConfigUpdate) (domain.MCPConfig, error) {
	enabledValue := "false"
	if req.Enabled {
		enabledValue = "true"
	}
	updatedAt := time.Now().UTC()
	if err := s.store.SetAppSettings(map[string]string{
		settingMCPEnabled: enabledValue,
	}, updatedAt); err != nil {
		s.recordOp("config_mcp", systemOperationVideoID, "", "", "error", err.Error())
		return domain.MCPConfig{}, err
	}

	s.setMCPEnabled(req.Enabled)
	s.recordOp(
		"config_mcp",
		systemOperationVideoID,
		"",
		"",
		"ok",
		fmt.Sprintf("enabled=%s", enabledValue),
	)

	return domain.MCPConfig{
		Enabled:   req.Enabled,
		Endpoint:  mcpEndpointPath,
		UpdatedAt: updatedAt,
	}, nil
}

// MCPEnabled reports whether Streamable MCP is currently on.
func (s *Service) MCPEnabled() bool {
	if s == nil {
		return false
	}
	return s.mcpEnabled.Load()
}

func (s *Service) setMCPEnabled(enabled bool) {
	s.mcpEnabled.Store(enabled)
}

func (s *Service) applyStoredMCPConfig() error {
	cfg, err := s.resolveMCPConfig()
	if err != nil {
		return err
	}
	s.setMCPEnabled(cfg.Enabled)
	return nil
}

func (s *Service) resolveMCPConfig() (domain.MCPConfig, error) {
	settings, err := s.store.GetAppSettings([]string{settingMCPEnabled})
	if err != nil {
		return domain.MCPConfig{}, err
	}

	enabled := s.cfg.MCPEnabled
	updatedAt := time.Time{}
	if setting, ok := settings[settingMCPEnabled]; ok {
		enabled = parseStoredBool(setting.Value, enabled)
		updatedAt = setting.UpdatedAt
	}

	return domain.MCPConfig{
		Enabled:   enabled,
		Endpoint:  mcpEndpointPath,
		UpdatedAt: updatedAt,
	}, nil
}
