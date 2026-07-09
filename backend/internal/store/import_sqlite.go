package store

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Store) migrateInitialSQLiteData(sqlitePath string) error {
	if s.dialect != dialectPostgres {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err = s.execTx(tx, `SELECT pg_advisory_xact_lock(?)`, int64(93070001)); err != nil {
		return fmt.Errorf("lock sqlite import migration: %w", err)
	}

	applied, err := s.isDataMigrationAppliedTx(tx, sqliteInitialDataMigration)
	if err != nil {
		return err
	}
	if applied {
		if err := tx.Commit(); err != nil {
			return err
		}
		committed = true
		return nil
	}

	targetRows, err := s.businessRowCountTx(tx)
	if err != nil {
		return err
	}
	if targetRows > 0 {
		return fmt.Errorf("postgres database already contains %d business rows; refusing to import sqlite data without migration marker", targetRows)
	}

	sourcePath := strings.TrimSpace(sqlitePath)
	if sourcePath == "" {
		if err := s.insertDataMigrationMarkerTx(tx, sqliteInitialDataMigration, "", "sqlite source not configured"); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		committed = true
		return nil
	}

	absSourcePath, err := filepath.Abs(sourcePath)
	if err != nil {
		return err
	}
	stat, err := os.Stat(absSourcePath)
	if errors.Is(err, os.ErrNotExist) {
		if err := s.insertDataMigrationMarkerTx(tx, sqliteInitialDataMigration, absSourcePath, "sqlite source not found"); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		committed = true
		return nil
	}
	if err != nil {
		return err
	}
	if stat.IsDir() {
		return fmt.Errorf("sqlite migration source is a directory: %s", absSourcePath)
	}
	backupPath, err := backupSQLiteSource(absSourcePath)
	if err != nil {
		return fmt.Errorf("backup sqlite migration source: %w", err)
	}

	source, err := openSQLite(absSourcePath)
	if err != nil {
		return fmt.Errorf("open sqlite migration source: %w", err)
	}
	defer func() {
		_ = source.Close()
	}()

	sourceRows, err := source.businessRowCount()
	if err != nil {
		return err
	}
	if sourceRows == 0 {
		if err := s.insertDataMigrationMarkerTx(tx, sqliteInitialDataMigration, absSourcePath, "sqlite source empty; backup="+backupPath); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		committed = true
		return nil
	}

	if _, err := s.copyTableRowsTx(tx, source, "videos", []string{
		"id", "path", "directory", "file_name", "title", "original_title", "year", "imdb_id", "tmdb_id", "media_type", "metadata_source", "series_title", "series_original_title", "series_imdb_id", "series_tmdb_id", "poster_path", "updated_at",
	}, "id"); err != nil {
		return err
	}
	if _, err := s.copyTableRowsTx(tx, source, "subtitles", []string{
		"id", "video_id", "path", "file_name", "language", "format", "size", "mod_time", "updated_at", "source", "source_detail",
	}, "id"); err != nil {
		return err
	}
	if _, err := s.copyTableRowsTx(tx, source, "scan_runs", []string{
		"id", "started_at", "finished_at", "video_count", "error",
	}, "id"); err != nil {
		return err
	}
	if _, err := s.copyTableRowsTx(tx, source, "operation_logs", []string{
		"id", "timestamp", "action", "video_id", "target_path", "backup_path", "status", "message",
	}, "id"); err != nil {
		return err
	}
	if _, err := s.copyTableRowsTx(tx, source, "app_settings", []string{
		"key", "value", "updated_at",
	}, "key"); err != nil {
		return err
	}
	if _, err := s.execTx(tx, `SELECT setval(pg_get_serial_sequence('scan_runs', 'id'), COALESCE((SELECT MAX(id) FROM scan_runs), 1), (SELECT MAX(id) FROM scan_runs) IS NOT NULL)`); err != nil {
		return fmt.Errorf("reset scan_runs identity: %w", err)
	}

	if err := s.insertDataMigrationMarkerTx(tx, sqliteInitialDataMigration, absSourcePath, fmt.Sprintf("imported %d sqlite business rows; backup=%s", sourceRows, backupPath)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Store) isDataMigrationAppliedTx(tx *sql.Tx, name string) (bool, error) {
	row := s.queryRowTx(tx, `SELECT COUNT(1) FROM data_migrations WHERE name = ?`, name)
	var count int
	if err := row.Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Store) insertDataMigrationMarkerTx(tx *sql.Tx, name string, source string, details string) error {
	_, err := s.execTx(
		tx,
		`INSERT INTO data_migrations(name, source, applied_at, details) VALUES(?, ?, ?, ?)`,
		name,
		source,
		time.Now().UTC().Format(time.RFC3339Nano),
		details,
	)
	return err
}

func (s *Store) businessRowCount() (int, error) {
	total := 0
	for _, tableName := range businessTables() {
		row := s.queryRow(`SELECT COUNT(1) FROM ` + tableName)
		var count int
		if err := row.Scan(&count); err != nil {
			return 0, err
		}
		total += count
	}
	return total, nil
}

func (s *Store) businessRowCountTx(tx *sql.Tx) (int, error) {
	total := 0
	for _, tableName := range businessTables() {
		row := s.queryRowTx(tx, `SELECT COUNT(1) FROM `+tableName)
		var count int
		if err := row.Scan(&count); err != nil {
			return 0, err
		}
		total += count
	}
	return total, nil
}

func businessTables() []string {
	return []string{"videos", "subtitles", "scan_runs", "operation_logs", "app_settings"}
}

func (s *Store) copyTableRowsTx(tx *sql.Tx, source *Store, tableName string, columns []string, orderBy string) (int, error) {
	selectQuery := `SELECT ` + strings.Join(columns, ", ") + ` FROM ` + tableName
	if strings.TrimSpace(orderBy) != "" {
		selectQuery += ` ORDER BY ` + orderBy
	}

	rows, err := source.query(selectQuery)
	if err != nil {
		return 0, fmt.Errorf("query sqlite %s: %w", tableName, err)
	}
	defer rows.Close()

	insertQuery := `INSERT INTO ` + tableName + `(` + strings.Join(columns, ", ") + `) VALUES(` + placeholders(len(columns)) + `)`
	values := make([]any, len(columns))
	scanTargets := make([]any, len(columns))
	for i := range scanTargets {
		scanTargets[i] = &values[i]
	}

	count := 0
	for rows.Next() {
		for i := range values {
			values[i] = nil
		}
		if err := rows.Scan(scanTargets...); err != nil {
			return count, fmt.Errorf("scan sqlite %s: %w", tableName, err)
		}
		for i, value := range values {
			if raw, ok := value.([]byte); ok {
				values[i] = string(raw)
			}
		}
		if _, err := s.execTx(tx, insertQuery, values...); err != nil {
			return count, fmt.Errorf("insert postgres %s: %w", tableName, err)
		}
		count += 1
	}
	if err := rows.Err(); err != nil {
		return count, err
	}
	return count, nil
}

func backupSQLiteSource(dbPath string) (string, error) {
	timestamp := time.Now().UTC().Format("20060102T150405.000000000Z")
	backupPath := dbPath + ".backup-" + timestamp
	copied := []string{}

	if err := copyFileExclusive(dbPath, backupPath); err != nil {
		return "", err
	}
	copied = append(copied, backupPath)

	for _, suffix := range []string{"-wal", "-shm"} {
		sourcePath := dbPath + suffix
		if _, err := os.Stat(sourcePath); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			removeFiles(copied)
			return "", err
		}

		targetPath := backupPath + suffix
		if err := copyFileExclusive(sourcePath, targetPath); err != nil {
			removeFiles(copied)
			return "", err
		}
		copied = append(copied, targetPath)
	}

	return backupPath, nil
}

func copyFileExclusive(sourcePath string, targetPath string) error {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("source is a directory: %s", sourcePath)
	}

	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()

	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	success := false
	defer func() {
		_ = target.Close()
		if !success {
			_ = os.Remove(targetPath)
		}
	}()

	if _, err := io.Copy(target, source); err != nil {
		return err
	}
	if err := target.Sync(); err != nil {
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}
	success = true
	return nil
}

func removeFiles(paths []string) {
	for _, path := range paths {
		_ = os.Remove(path)
	}
}
