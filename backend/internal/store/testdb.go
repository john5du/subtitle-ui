package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var testSchemaSeq atomic.Int64

// TestDSN creates an isolated Postgres schema and returns a DSN scoped to it.
// Requires TEST_POSTGRES_DSN or DATABASE_URL.
func TestDSN(t testing.TB) string {
	t.Helper()

	base := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if base == "" {
		base = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if base == "" {
		t.Skip("TEST_POSTGRES_DSN or DATABASE_URL is not set")
	}

	schema := fmt.Sprintf("su_%d_%d", time.Now().UnixNano(), testSchemaSeq.Add(1))
	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatalf("open postgres admin connection: %v", err)
	}
	quotedSchema := quotePostgresIdentifier(schema)
	if _, err := admin.Exec("CREATE SCHEMA " + quotedSchema); err != nil {
		_ = admin.Close()
		t.Fatalf("create postgres test schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec("DROP SCHEMA IF EXISTS " + quotedSchema + " CASCADE")
		_ = admin.Close()
	})

	return withPostgresSearchPath(base, schema)
}

func withPostgresSearchPath(dsn string, schema string) string {
	if parsed, err := url.Parse(dsn); err == nil && parsed.Scheme != "" {
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema
}

func quotePostgresIdentifier(raw string) string {
	q := string(rune(34))
	return q + strings.ReplaceAll(raw, q, q+q) + q
}
