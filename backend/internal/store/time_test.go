package store

import (
	"testing"
	"time"
)

func TestParseStoredTime(t *testing.T) {
	want := time.Date(2024, 6, 1, 12, 30, 45, 123456789, time.UTC)
	got := parseStoredTime(want.Format(time.RFC3339Nano))
	if !got.Equal(want) {
		t.Fatalf("rfc3339nano: got %v want %v", got, want)
	}

	got = parseStoredTime("2024-06-01T12:30:45Z")
	if got.Year() != 2024 || got.Month() != 6 || got.Day() != 1 {
		t.Fatalf("rfc3339: got %v", got)
	}

	if !parseStoredTime("").IsZero() {
		t.Fatal("empty should be zero")
	}
	if !parseStoredTime("not-a-time").IsZero() {
		t.Fatal("invalid should be zero, not Now()")
	}
	before := time.Now().UTC()
	got = parseStoredTime("garbage")
	if !got.IsZero() {
		t.Fatalf("garbage should be zero, got %v after %v", got, before)
	}
}
