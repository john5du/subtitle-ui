package app

import (
	"subtitle-ui/backend/internal/domain"
)

func (s *Service) ListLogsPage(page int, pageSize int) domain.OperationLogPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = defaultLogPageSize
	}
	if pageSize > 200 {
		pageSize = 200
	}

	logs, total, err := s.store.ListLogs(page, pageSize)
	if err != nil {
		return domain.OperationLogPage{
			Items:      []domain.OperationLog{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return domain.OperationLogPage{
		Items:      logs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

func (s *Service) ListLogs(limit int) []domain.OperationLog {
	if limit <= 0 {
		limit = 50
	}
	return s.ListLogsPage(1, limit).Items
}

func (s *Service) ClearLogs() error {
	return s.store.ClearLogs()
}
