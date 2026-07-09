package store

import (
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
)

func (s *Store) GetAppSettings(keys []string) (map[string]domain.AppSetting, error) {
	out := make(map[string]domain.AppSetting, len(keys))
	if len(keys) == 0 {
		return out, nil
	}

	placeholders := make([]string, len(keys))
	args := make([]any, len(keys))
	for i, key := range keys {
		placeholders[i] = "?"
		args[i] = key
	}

	rows, err := s.query(
		`SELECT key, value, updated_at FROM app_settings WHERE key IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			setting    domain.AppSetting
			updatedRaw string
		)
		if err := rows.Scan(&setting.Key, &setting.Value, &updatedRaw); err != nil {
			return nil, err
		}
		setting.UpdatedAt = parseTimeOrNow(updatedRaw)
		out[setting.Key] = setting
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) SetAppSettings(values map[string]string, updatedAt time.Time) error {
	if len(values) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	updatedValue := updatedAt.UTC().Format(time.RFC3339Nano)
	query := s.insertPrefix() + ` INTO app_settings(key, value, updated_at) VALUES(?, ?, ?)`
	if s.dialect == dialectPostgres {
		query += ` ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
	}
	for key, value := range values {
		if _, err = s.execTx(tx, query, key, value, updatedValue); err != nil {
			return err
		}
	}

	return tx.Commit()
}
