package store

import (
	"database/sql"
	"fmt"
	"strings"
)

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) DatabaseType() string {
	return "postgres"
}

func (s *Store) exec(query string, args ...any) (sql.Result, error) {
	return s.db.Exec(rebind(query), args...)
}

func (s *Store) query(query string, args ...any) (*sql.Rows, error) {
	return s.db.Query(rebind(query), args...)
}

func (s *Store) queryRow(query string, args ...any) *sql.Row {
	return s.db.QueryRow(rebind(query), args...)
}

func (s *Store) execTx(tx *sql.Tx, query string, args ...any) (sql.Result, error) {
	return tx.Exec(rebind(query), args...)
}

func (s *Store) execScript(query string) error {
	for _, statement := range strings.Split(query, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := s.exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) execScriptTx(tx *sql.Tx, query string) error {
	for _, statement := range strings.Split(query, ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := s.execTx(tx, statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) queryTx(tx *sql.Tx, query string, args ...any) (*sql.Rows, error) {
	return tx.Query(rebind(query), args...)
}

func (s *Store) queryRowTx(tx *sql.Tx, query string, args ...any) *sql.Row {
	return tx.QueryRow(rebind(query), args...)
}

// rebind rewrites ? placeholders to Postgres $1, $2, … form.
func rebind(query string) string {
	var b strings.Builder
	b.Grow(len(query) + 8)
	index := 1
	for _, r := range query {
		if r == '?' {
			b.WriteByte('$')
			b.WriteString(fmt.Sprint(index))
			index += 1
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	out := make([]string, count)
	for i := range out {
		out[i] = "?"
	}
	return strings.Join(out, ",")
}

func (s *Store) settingsUpsertSuffix() string {
	return ` ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
}

func (s *Store) yearSortExprs() (emptyExpr, yearExpr string) {
	return `CASE WHEN trim(coalesce(year, '')) = '' THEN 1 ELSE 0 END`,
		`CASE WHEN trim(coalesce(year, '')) ~ '^[0-9]+$' THEN CAST(year AS INTEGER) ELSE 0 END`
}

func (s *Store) videoUpsertSuffix() string {
	return ` ON CONFLICT(id) DO UPDATE SET
  path = excluded.path,
  directory = excluded.directory,
  file_name = excluded.file_name,
  title = excluded.title,
  original_title = excluded.original_title,
  year = excluded.year,
  imdb_id = excluded.imdb_id,
  tmdb_id = excluded.tmdb_id,
  media_type = excluded.media_type,
  metadata_source = excluded.metadata_source,
  series_title = excluded.series_title,
  series_original_title = excluded.series_original_title,
  series_imdb_id = excluded.series_imdb_id,
  series_tmdb_id = excluded.series_tmdb_id,
  poster_path = excluded.poster_path,
  file_size = excluded.file_size,
  file_mod_time = excluded.file_mod_time,
  scan_fingerprint = excluded.scan_fingerprint,
  updated_at = excluded.updated_at,
  title_sort_key = excluded.title_sort_key`
}

func (s *Store) subtitleUpsertSuffix() string {
	return ` ON CONFLICT(id) DO UPDATE SET
  video_id = excluded.video_id,
  path = excluded.path,
  file_name = excluded.file_name,
  language = excluded.language,
  format = excluded.format,
  size = excluded.size,
  mod_time = excluded.mod_time,
  updated_at = excluded.updated_at,
  source = excluded.source,
  source_detail = excluded.source_detail`
}
