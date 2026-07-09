package store

import (
	"time"

	"subtitle-ui/backend/internal/domain"
)

func (s *Store) AppendLog(log domain.OperationLog) error {
	_, err := s.exec(
		`INSERT INTO operation_logs(id, timestamp, action, video_id, target_path, backup_path, status, message)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
		log.ID,
		log.Timestamp.UTC().Format(time.RFC3339Nano),
		log.Action,
		log.VideoID,
		log.TargetPath,
		log.BackupPath,
		log.Status,
		log.Message,
	)
	return err
}

func (s *Store) ListLogs(page int, pageSize int) ([]domain.OperationLog, int, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 8
	}
	if pageSize > 200 {
		pageSize = 200
	}

	total, err := s.countByQuery(`SELECT COUNT(1) FROM operation_logs`, nil)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	rows, err := s.query(
		`SELECT id, timestamp, action, video_id, target_path, backup_path, status, message
FROM operation_logs ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
		pageSize,
		offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]domain.OperationLog, 0, pageSize)
	for rows.Next() {
		var (
			log       domain.OperationLog
			timeValue string
		)
		if err := rows.Scan(
			&log.ID,
			&timeValue,
			&log.Action,
			&log.VideoID,
			&log.TargetPath,
			&log.BackupPath,
			&log.Status,
			&log.Message,
		); err != nil {
			return nil, 0, err
		}
		log.Timestamp = parseTimeOrNow(timeValue)
		out = append(out, log)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (s *Store) ClearLogs() error {
	_, err := s.exec(`DELETE FROM operation_logs`)
	return err
}
