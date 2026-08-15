package store

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"subtitle-ui/backend/internal/domain"
)

func TestStorePing(t *testing.T) {
	st, err := Open(TestDSN(t))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	if err := st.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := st.Ping(context.Background()); err == nil {
		t.Fatal("expected ping to fail after close")
	}
}

func TestSaveScanReconcilePreservesNewerSubtitleUpdate(t *testing.T) {
	st, err := Open(TestDSN(t))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	scanStarted := time.Now().UTC().Add(-2 * time.Second)
	seededAt := scanStarted.Add(-time.Second)
	video := concurrencyTestVideo(t, "V-SKIP", seededAt, []domain.Subtitle{
		concurrencyTestSubtitle("S-OLD", "movie.zh.srt", seededAt),
	})
	if err := st.SaveScanResult([]domain.Video{video}, seededAt, seededAt.Add(time.Millisecond), "", nil); err != nil {
		t.Fatalf("seed scan: %v", err)
	}

	updatedAt := time.Now().UTC()
	fresh := []domain.Subtitle{
		concurrencyTestSubtitle("S-NEW", "movie.en.srt", updatedAt),
	}
	if err := st.UpdateVideoSubtitles(video.ID, fresh, updatedAt); err != nil {
		t.Fatalf("update subtitles: %v", err)
	}

	stale := video
	stale.UpdatedAt = scanStarted
	stale.Title = "Stale Title"
	stale.Subtitles = []domain.Subtitle{
		concurrencyTestSubtitle("S-OLD", "movie.zh.srt", scanStarted),
	}
	if err := st.SaveScanReconcile([]domain.Video{stale}, []domain.Video{stale}, scanStarted, time.Now().UTC(), "", nil); err != nil {
		t.Fatalf("overlapping scan save: %v", err)
	}

	got, found, err := st.GetVideo(video.ID)
	if err != nil {
		t.Fatalf("get video: %v", err)
	}
	if !found {
		t.Fatal("expected video to exist")
	}
	if got.Title != "Stale Title" {
		t.Fatalf("expected metadata from scan, got title %q", got.Title)
	}
	if len(got.Subtitles) != 1 || got.Subtitles[0].ID != "S-NEW" || got.Subtitles[0].FileName != "movie.en.srt" {
		t.Fatalf("expected newer subtitle to be preserved, got %+v", got.Subtitles)
	}
}

func TestSaveScanReconcileAndUpdateVideoSubtitlesConcurrent(t *testing.T) {
	st, err := Open(TestDSN(t))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	scanStarted := time.Now().UTC().Add(-time.Second)
	seededAt := scanStarted.Add(-time.Second)
	video := concurrencyTestVideo(t, "V-RACE", seededAt, []domain.Subtitle{
		concurrencyTestSubtitle("S-OLD", "movie.zh.srt", seededAt),
	})
	if err := st.SaveScanResult([]domain.Video{video}, seededAt, seededAt.Add(time.Millisecond), "", nil); err != nil {
		t.Fatalf("seed scan: %v", err)
	}

	stale := video
	stale.UpdatedAt = scanStarted
	stale.Subtitles = []domain.Subtitle{
		concurrencyTestSubtitle("S-OLD", "movie.zh.srt", scanStarted),
	}
	freshAt := time.Now().UTC()
	fresh := []domain.Subtitle{
		concurrencyTestSubtitle("S-NEW", "movie.en.srt", freshAt),
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		errs <- st.SaveScanReconcile([]domain.Video{stale}, []domain.Video{stale}, scanStarted, time.Now().UTC(), "", nil)
	}()
	go func() {
		defer wg.Done()
		errs <- st.UpdateVideoSubtitles(video.ID, fresh, freshAt)
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent write: %v", err)
		}
	}

	got, found, err := st.GetVideo(video.ID)
	if err != nil {
		t.Fatalf("get video: %v", err)
	}
	if !found {
		t.Fatal("expected video to exist")
	}
	if len(got.Subtitles) != 1 || got.Subtitles[0].ID != "S-NEW" || got.Subtitles[0].FileName != "movie.en.srt" {
		t.Fatalf("expected concurrent subtitle update to win, got %+v", got.Subtitles)
	}
}

func concurrencyTestVideo(t *testing.T, id string, updatedAt time.Time, subs []domain.Subtitle) domain.Video {
	t.Helper()
	dir := t.TempDir()
	return domain.Video{
		ID:             id,
		Path:           filepath.Join(dir, "movie.mkv"),
		Directory:      dir,
		FileName:       "movie.mkv",
		Title:          id,
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      updatedAt,
		Subtitles:      subs,
	}
}

func concurrencyTestSubtitle(id, fileName string, modTime time.Time) domain.Subtitle {
	return domain.Subtitle{
		ID:       id,
		Path:     filepath.Join("/media", fileName),
		FileName: fileName,
		Language: "und",
		Format:   "srt",
		Size:     12,
		ModTime:  modTime,
		Source:   domain.SubtitleSourceUpload,
	}
}
