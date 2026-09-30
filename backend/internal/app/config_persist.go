package app

import (
	"time"
)

func storedEnabledFlag(enabled bool) string {
	if enabled {
		return "true"
	}
	return "false"
}

func (s *Service) persistAppSettings(opAction string, values map[string]string) (time.Time, error) {
	updatedAt := time.Now().UTC()
	if err := s.store.SetAppSettings(values, updatedAt); err != nil {
		s.recordOp(opAction, systemOperationVideoID, "", "", "error", err.Error())
		return time.Time{}, err
	}
	return updatedAt, nil
}
