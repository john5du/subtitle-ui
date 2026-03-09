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

	videos, total, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "", "")
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

func TestListVideosSortByYear(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sort.sqlite3")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	now := time.Now().UTC()
	videos := []domain.Video{
		{
			ID:             "A",
			Path:           filepath.Join(t.TempDir(), "a.mkv"),
			Directory:      filepath.Join(t.TempDir(), "show"),
			FileName:       "a.mkv",
			Title:          "A",
			Year:           "2022",
			MediaType:      domain.MediaTypeMovie,
			MetadataSource: "nfo",
			UpdatedAt:      now,
		},
		{
			ID:             "B",
			Path:           filepath.Join(t.TempDir(), "b.mkv"),
			Directory:      filepath.Join(t.TempDir(), "show"),
			FileName:       "b.mkv",
			Title:          "B",
			Year:           "2024",
			MediaType:      domain.MediaTypeMovie,
			MetadataSource: "nfo",
			UpdatedAt:      now,
		},
		{
			ID:             "C",
			Path:           filepath.Join(t.TempDir(), "c.mkv"),
			Directory:      filepath.Join(t.TempDir(), "show"),
			FileName:       "c.mkv",
			Title:          "C",
			Year:           "",
			MediaType:      domain.MediaTypeMovie,
			MetadataSource: "nfo",
			UpdatedAt:      now,
		},
	}

	if err := st.SaveScanResult(videos, now, now, ""); err != nil {
		t.Fatalf("save scan result: %v", err)
	}

	desc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "year", "desc")
	if err != nil {
		t.Fatalf("list videos desc: %v", err)
	}
	if len(desc) != 3 {
		t.Fatalf("expected 3 videos in desc, got %d", len(desc))
	}
	if desc[0].Year != "2024" || desc[1].Year != "2022" || desc[2].Year != "" {
		t.Fatalf("unexpected desc order: %q, %q, %q", desc[0].Year, desc[1].Year, desc[2].Year)
	}

	asc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "year", "asc")
	if err != nil {
		t.Fatalf("list videos asc: %v", err)
	}
	if len(asc) != 3 {
		t.Fatalf("expected 3 videos in asc, got %d", len(asc))
	}
	if asc[0].Year != "2022" || asc[1].Year != "2024" || asc[2].Year != "" {
		t.Fatalf("unexpected asc order: %q, %q, %q", asc[0].Year, asc[1].Year, asc[2].Year)
	}
}
