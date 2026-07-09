package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type Store struct {
	db      *sql.DB
	dialect sqlDialect
}

type subtitleSourceInfo struct {
	Source       string
	SourceDetail string
}

type Driver string

const (
	DriverSQLite   Driver = "sqlite"
	DriverPostgres Driver = "postgres"
)

type OpenOptions struct {
	Driver      Driver
	SQLitePath  string
	PostgresURL string
}

type sqlDialect string

const (
	dialectSQLite   sqlDialect = "sqlite"
	dialectPostgres sqlDialect = "postgres"
)

const sqliteInitialDataMigration = "sqlite_initial_import"

func Open(dbPath string) (*Store, error) {
	return OpenWithOptions(OpenOptions{
		Driver:     DriverSQLite,
		SQLitePath: dbPath,
	})
}

func OpenWithOptions(options OpenOptions) (*Store, error) {
	driver := options.Driver
	if driver == "" {
		if strings.TrimSpace(options.PostgresURL) != "" {
			driver = DriverPostgres
		} else {
			driver = DriverSQLite
		}
	}

	switch driver {
	case DriverPostgres:
		return openPostgres(options.PostgresURL, options.SQLitePath)
	case DriverSQLite:
		return openSQLite(options.SQLitePath)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", driver)
	}
}

func openSQLite(dbPath string) (*Store, error) {
	absPath, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", absPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`PRAGMA foreign_keys = ON;`); err != nil {
		_ = db.Close()
		return nil, err
	}

	s := &Store{db: db, dialect: dialectSQLite}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func openPostgres(databaseURL string, sqlitePath string) (*Store, error) {
	dsn := strings.TrimSpace(databaseURL)
	if dsn == "" {
		return nil, errors.New("postgres database URL is required")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Hour)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}

	s := &Store{db: db, dialect: dialectPostgres}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.migrateInitialSQLiteData(sqlitePath); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}
