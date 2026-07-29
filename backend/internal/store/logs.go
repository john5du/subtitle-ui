package store

import (
	"database/sql"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
)

func (s *Store) AppendLog(log domain.OperationLog) error {
	_, err := s.exec(
		`INSERT INTO operation_logs(id, timestamp, action, video_id, target_path, backup_path, status, message, source, tool, op_group, meta)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		log.ID,
		log.Timestamp.UTC().Format(time.RFC3339Nano),
		log.Action,
		log.VideoID,
		log.TargetPath,
		log.BackupPath,
		log.Status,
		log.Message,
		log.Source,
		log.Tool,
		log.OpGroup,
		log.Meta,
	)
	return err
}

func (s *Store) GetLog(id string) (domain.OperationLog, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.OperationLog{}, sql.ErrNoRows
	}
	row := s.queryRow(
		`SELECT id, timestamp, action, video_id, target_path, backup_path, status, message, source, tool, op_group, meta
FROM operation_logs WHERE id = ?`,
		id,
	)
	return scanOperationLog(row)
}

func (s *Store) ListLogs(page int, pageSize int) ([]domain.OperationLog, int, error) {
	return s.ListLogsFiltered(page, pageSize, domain.OperationLogFilter{})
}

func (s *Store) ListLogsFiltered(page int, pageSize int, filter domain.OperationLogFilter) ([]domain.OperationLog, int, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 8
	}
	if pageSize > 200 {
		pageSize = 200
	}

	where, args := buildLogFilter(filter)
	countSQL := `SELECT COUNT(1) FROM operation_logs` + where
	total, err := s.countByQuery(countSQL, args)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	listSQL := `SELECT id, timestamp, action, video_id, target_path, backup_path, status, message, source, tool, op_group, meta
FROM operation_logs` + where + ` ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`
	listArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := s.query(listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]domain.OperationLog, 0, pageSize)
	for rows.Next() {
		log, err := scanOperationLog(rows)
		if err != nil {
			return nil, 0, err
		}
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

// ClearLogsBefore deletes logs with timestamp strictly before before (UTC).
func (s *Store) ClearLogsBefore(before time.Time) (int, error) {
	cutoff := before.UTC().Format(time.RFC3339Nano)
	res, err := s.exec(`DELETE FROM operation_logs WHERE timestamp < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return int(n), nil
}

// CountLogsBefore counts rows older than before.
func (s *Store) CountLogsBefore(before time.Time) (int, error) {
	cutoff := before.UTC().Format(time.RFC3339Nano)
	return s.countByQuery(`SELECT COUNT(1) FROM operation_logs WHERE timestamp < ?`, []any{cutoff})
}

type scannable interface {
	Scan(dest ...any) error
}

func scanOperationLog(row scannable) (domain.OperationLog, error) {
	var (
		log       domain.OperationLog
		timeValue string
	)
	if err := row.Scan(
		&log.ID,
		&timeValue,
		&log.Action,
		&log.VideoID,
		&log.TargetPath,
		&log.BackupPath,
		&log.Status,
		&log.Message,
		&log.Source,
		&log.Tool,
		&log.OpGroup,
		&log.Meta,
	); err != nil {
		return domain.OperationLog{}, err
	}
	log.Timestamp = parseTimeOrNow(timeValue)
	return log, nil
}

func buildLogFilter(filter domain.OperationLogFilter) (string, []any) {
	var parts []string
	var args []any
	if v := strings.TrimSpace(filter.Action); v != "" {
		parts = append(parts, `action = ?`)
		args = append(args, v)
	}
	if v := strings.TrimSpace(filter.VideoID); v != "" {
		parts = append(parts, `video_id = ?`)
		args = append(args, v)
	}
	if v := strings.TrimSpace(filter.Source); v != "" {
		parts = append(parts, `source = ?`)
		args = append(args, v)
	}
	if v := strings.TrimSpace(filter.Tool); v != "" {
		parts = append(parts, `tool = ?`)
		args = append(args, v)
	}
	if len(parts) == 0 {
		return "", nil
	}
	return ` WHERE ` + strings.Join(parts, ` AND `), args
}
