package app

import (
	"errors"
	"testing"

	"subtitle-ui/backend/internal/domain"
)

func TestListVideosPagePropagatesStoreError(t *testing.T) {
	svc, _ := newMovieServiceFixture(t, t.TempDir(), "")
	_ = svc.Close()

	_, err := svc.ListVideosPage("", domain.MediaTypeMovie, "", 1, 20, "", "")
	if err == nil {
		t.Fatal("expected store error from ListVideosPage")
	}
	if errors.Is(err, ErrNotFound) {
		t.Fatalf("store error must not be ErrNotFound, got %v", err)
	}
}

func TestGetVideoDistinguishesMissingAndStoreError(t *testing.T) {
	svc, video := newMovieServiceFixture(t, t.TempDir(), "1\n00:00:01,000 --> 00:00:02,000\nhello\n")

	got, err := svc.GetVideo(video.ID)
	if err != nil {
		t.Fatalf("GetVideo existing: %v", err)
	}
	if got.ID != video.ID {
		t.Fatalf("GetVideo id=%s want %s", got.ID, video.ID)
	}

	_, err = svc.GetVideo("missing-video-id")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing video should be ErrNotFound, got %v", err)
	}

	_ = svc.Close()
	_, err = svc.GetVideo(video.ID)
	if err == nil {
		t.Fatal("expected store error from GetVideo after close")
	}
	if errors.Is(err, ErrNotFound) {
		t.Fatalf("store error must not be ErrNotFound, got %v", err)
	}
}

func TestListLogsPageFilteredPropagatesStoreError(t *testing.T) {
	svc, _ := newMovieServiceFixture(t, t.TempDir(), "")
	_ = svc.Close()

	_, err := svc.ListLogsPageFiltered(1, 10, domain.OperationLogFilter{})
	if err == nil {
		t.Fatal("expected store error from ListLogsPageFiltered")
	}
	if errors.Is(err, ErrNotFound) {
		t.Fatalf("store error must not be ErrNotFound, got %v", err)
	}
}

func TestGetOperationLogMapsOnlyNoRows(t *testing.T) {
	svc, _ := newMovieServiceFixture(t, t.TempDir(), "")

	_, err := svc.GetOperationLog("missing-op-id")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing log should be ErrNotFound, got %v", err)
	}

	_ = svc.Close()
	_, err = svc.GetOperationLog("missing-op-id")
	if err == nil {
		t.Fatal("expected store error from GetOperationLog after close")
	}
	if errors.Is(err, ErrNotFound) {
		t.Fatalf("store error must not be mapped to ErrNotFound, got %v", err)
	}
}

func TestRollbackOperationMapsOnlyNoRows(t *testing.T) {
	svc, _ := newMovieServiceFixture(t, t.TempDir(), "1\n00:00:01,000 --> 00:00:02,000\nhello\n")

	_, err := svc.RollbackOperation("missing-op-id")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing op should be ErrNotFound, got %v", err)
	}

	_ = svc.Close()
	_, err = svc.RollbackOperation("missing-op-id")
	if err == nil {
		t.Fatal("expected store error from RollbackOperation after close")
	}
	if errors.Is(err, ErrNotFound) {
		t.Fatalf("store error must not be mapped to ErrNotFound, got %v", err)
	}
}
