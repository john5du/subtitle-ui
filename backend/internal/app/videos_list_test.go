package app

import (
	"testing"

	"subtitle-ui/backend/internal/domain"
)

func TestCalculateVideoChangesIgnoresEmptyFingerprint(t *testing.T) {
	before := []domain.Video{
		{ID: "legacy", ScanFingerprint: ""},
		{ID: "same", ScanFingerprint: "fp-same"},
		{ID: "changed", ScanFingerprint: "fp-old"},
		{ID: "gone", ScanFingerprint: "fp-gone"},
	}
	current := []domain.Video{
		{ID: "legacy", ScanFingerprint: "fp-new"},
		{ID: "same", ScanFingerprint: "fp-same"},
		{ID: "changed", ScanFingerprint: "fp-new"},
		{ID: "blank-now", ScanFingerprint: ""},
		{ID: "added", ScanFingerprint: "fp-added"},
	}
	before = append(before, domain.Video{ID: "blank-now", ScanFingerprint: "fp-was"})

	got := calculateVideoChanges(before, current)
	if got.Added != 1 || got.Updated != 1 || got.Removed != 1 {
		t.Fatalf("changes=%+v, want added=1 updated=1 removed=1", got)
	}
}
