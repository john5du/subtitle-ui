package app

import (
	"fmt"
	"time"

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
	if err := s.store.ClearLogs(); err != nil {
		s.recordOp("clear_logs", systemOperationVideoID, "", "", "error", err.Error())
		return err
	}
	s.recordOp("clear_logs", systemOperationVideoID, "", "", "ok", "operation logs cleared")
	return nil
}

// recordOp appends a domain operation log row for user-facing audit.
func (s *Service) recordOp(action, videoID, targetPath, backupPath, status, message string) {
	if videoID == "" {
		videoID = systemOperationVideoID
	}
	if status == "" {
		status = "ok"
	}
	seed := fmt.Sprintf("%s-%s-%s-%d", action, videoID, targetPath, time.Now().UnixNano())
	_ = s.store.AppendLog(domain.OperationLog{
		ID:         makeID(seed),
		Timestamp:  time.Now().UTC(),
		Action:     action,
		VideoID:    videoID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     status,
		Message:    message,
	})
}
