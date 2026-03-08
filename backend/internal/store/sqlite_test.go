package store

import (
	"path/filepath"
	"testing"
	"time"

	"subtitle-ui/backend/internal/domain"
)

func TestStoreScanAndLogs(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.sqlite3")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	now := time.Now().UTC()
	video := domain.Video{
		ID:             "V1",
		Path:           filepath.Join(t.TempDir(), "movie.mkv"),
		Directory:      filepath.Join(t.TempDir(), "dir"),
		FileName:       "movie.mkv",
		Title:          "Movie",
		Year:           "2025",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:       "S1",
				Path:     filepath.Join(t.TempDir(), "movie.zh.srt"),
				FileName: "movie.zh.srt",
				Language: "zh",
				Format:   "srt",
				Size:     128,
				ModTime:  now,
			},
		},
	}

	if err := st.SaveScanResult([]domain.Video{video}, now, now.Add(time.Second), ""); err != nil {
		t.Fatalf("save scan result: %v", err)
	}

	videos, total, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20)
	if err != nil {
		t.Fatalf("list videos: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}
	if len(videos) != 1 {
		t.Fatalf("expected 1 video, got %d", len(videos))
	}
	if len(videos[0].Subtitles) != 1 {
		t.Fatalf("expected 1 subtitle, got %d", len(videos[0].Subtitles))
	}

	status, err := st.GetLatestScanStatus()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.VideoCount != 1 {
		t.Fatalf("expected videoCount=1, got %d", status.VideoCount)
	}

	logItem := domain.OperationLog{
		ID:         "L1",
		Timestamp:  now,
		Action:     "upload",
		VideoID:    "V1",
		TargetPath: "movie.zh.srt",
		Status:     "ok",
	}
	if err := st.AppendLog(logItem); err != nil {
		t.Fatalf("append log: %v", err)
	}

	logs, err := st.ListLogs(10)
	if err != nil {
		t.Fatalf("list logs: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}
	if logs[0].ID != "L1" {
		t.Fatalf("unexpected log id: %s", logs[0].ID)
	}
}
