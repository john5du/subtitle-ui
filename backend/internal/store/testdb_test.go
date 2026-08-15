package store

import (
	"database/sql"
	"strings"
	"testing"
)

func TestTestDSNUsesIsolatedSearchPath(t *testing.T) {
	dsnA := TestDSN(t)
	dsnB := TestDSN(t)

	dbA, err := sql.Open("pgx", dsnA)
	if err != nil {
		t.Fatalf("open schema A: %v", err)
	}
	defer func() { _ = dbA.Close() }()
	dbB, err := sql.Open("pgx", dsnB)
	if err != nil {
		t.Fatalf("open schema B: %v", err)
	}
	defer func() { _ = dbB.Close() }()

	var schemaA, schemaB string
	if err := dbA.QueryRow(`SELECT current_schema()`).Scan(&schemaA); err != nil {
		t.Fatalf("current schema A: %v", err)
	}
	if err := dbB.QueryRow(`SELECT current_schema()`).Scan(&schemaB); err != nil {
		t.Fatalf("current schema B: %v", err)
	}
	if !strings.HasPrefix(schemaA, "su_") || !strings.HasPrefix(schemaB, "su_") {
		t.Fatalf("expected isolated su_ schemas, got %q and %q", schemaA, schemaB)
	}
	if schemaA == schemaB {
		t.Fatalf("expected distinct test schemas, both were %q", schemaA)
	}

	if _, err := dbA.Exec(`CREATE TABLE test_schema_marker(id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("create marker in schema A: %v", err)
	}
	var visible sql.NullString
	if err := dbB.QueryRow(`SELECT to_regclass('test_schema_marker')::text`).Scan(&visible); err != nil {
		t.Fatalf("look up marker from schema B: %v", err)
	}
	if visible.Valid {
		t.Fatalf("schema B unexpectedly resolved schema A marker as %q", visible.String)
	}
}
