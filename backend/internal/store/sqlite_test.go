package store

import (
	"database/sql"
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
		PosterPath:     filepath.Join(t.TempDir(), "dir", "poster.jpg"),
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:           "S1",
				Path:         filepath.Join(t.TempDir(), "movie.zh.srt"),
				FileName:     "movie.zh.srt",
				Language:     "zh",
				Format:       "srt",
				Size:         128,
				ModTime:      now,
				Source:       domain.SubtitleSourceUpload,
				SourceDetail: "upload.zh.srt",
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
	if videos[0].Subtitles[0].Source != domain.SubtitleSourceUpload || videos[0].Subtitles[0].SourceDetail != "upload.zh.srt" {
		t.Fatalf("unexpected subtitle source: %+v", videos[0].Subtitles[0])
	}
	if videos[0].PosterPath != video.PosterPath {
		t.Fatalf("expected poster path %q, got %q", video.PosterPath, videos[0].PosterPath)
	}

	storedVideo, found, err := st.GetVideo("V1")
	if err != nil {
		t.Fatalf("get video: %v", err)
	}
	if !found {
		t.Fatalf("expected stored video to exist")
	}
	if storedVideo.PosterPath != video.PosterPath {
		t.Fatalf("expected stored poster path %q, got %q", video.PosterPath, storedVideo.PosterPath)
	}
	if storedVideo.Subtitles[0].Source != domain.SubtitleSourceUpload || storedVideo.Subtitles[0].SourceDetail != "upload.zh.srt" {
		t.Fatalf("expected stored subtitle source to be preserved, got %+v", storedVideo.Subtitles[0])
	}

	rescanned := video
	rescanned.Subtitles[0].Source = domain.SubtitleSourceDirectory
	rescanned.Subtitles[0].SourceDetail = ""
	if err := st.SaveScanResult([]domain.Video{rescanned}, now.Add(2*time.Second), now.Add(3*time.Second), ""); err != nil {
		t.Fatalf("save rescan result: %v", err)
	}
	afterRescan, found, err := st.GetVideo("V1")
	if err != nil {
		t.Fatalf("get video after rescan: %v", err)
	}
	if !found {
		t.Fatalf("expected stored video after rescan")
	}
	if afterRescan.Subtitles[0].Source != domain.SubtitleSourceUpload || afterRescan.Subtitles[0].SourceDetail != "upload.zh.srt" {
		t.Fatalf("expected rescan to preserve subtitle source, got %+v", afterRescan.Subtitles[0])
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

	logs, total, err := st.ListLogs(1, 10)
	if err != nil {
		t.Fatalf("list logs: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected 1 total log, got %d", total)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}
	if logs[0].ID != "L1" {
		t.Fatalf("unexpected log id: %s", logs[0].ID)
	}
}

func TestMigrationV5AddsAndBackfillsSubtitleSources(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.sqlite3")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	statements := []string{
		`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
		`INSERT INTO schema_migrations(version, applied_at) VALUES(1, '` + now + `'), (2, '` + now + `'), (3, '` + now + `'), (4, '` + now + `')`,
		`CREATE TABLE subtitles (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'und',
  format TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  mod_time TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
		`CREATE TABLE operation_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  video_id TEXT NOT NULL,
  target_path TEXT NOT NULL DEFAULT '',
  backup_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT ''
)`,
		`INSERT INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at)
VALUES('S1', 'V1', '/media/movie.zh.srt', 'movie.zh.srt', 'zh', 'srt', 1, '` + now + `', '` + now + `'),
      ('S2', 'V1', '/media/movie.zh.ass', 'movie.zh.ass', 'zh', 'ass', 1, '` + now + `', '` + now + `')`,
		`INSERT INTO operation_logs(id, timestamp, action, video_id, target_path, status, message)
VALUES('L1', '` + now + `', 'upload', 'V1', '/media/movie.zh.srt', 'ok', ''),
      ('L2', '` + now + `', 'convert', 'V1', '/media/movie.zh.ass', 'ok', 'generated from movie.zh.srt')`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			_ = db.Close()
			t.Fatalf("prepare legacy db: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	rows, err := st.db.Query(`SELECT file_name, source, source_detail FROM subtitles ORDER BY file_name ASC`)
	if err != nil {
		t.Fatalf("query migrated subtitles: %v", err)
	}
	defer rows.Close()

	got := map[string]subtitleSourceInfo{}
	for rows.Next() {
		var fileName string
		var info subtitleSourceInfo
		if err := rows.Scan(&fileName, &info.Source, &info.SourceDetail); err != nil {
			t.Fatalf("scan migrated subtitle: %v", err)
		}
		got[fileName] = info
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate migrated subtitles: %v", err)
	}
	if got["movie.zh.ass"].Source != domain.SubtitleSourceGenerated || got["movie.zh.ass"].SourceDetail != "movie.zh.srt" {
		t.Fatalf("unexpected generated backfill: %+v", got["movie.zh.ass"])
	}
	if got["movie.zh.srt"].Source != domain.SubtitleSourceUpload || got["movie.zh.srt"].SourceDetail != "movie.zh.srt" {
		t.Fatalf("unexpected upload backfill: %+v", got["movie.zh.srt"])
	}
}

func TestListLogsPagesAndClear(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "logs.sqlite3")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	now := time.Now().UTC()
	for index := 1; index <= 3; index += 1 {
		item := domain.OperationLog{
			ID:         "L" + string(rune('0'+index)),
			Timestamp:  now.Add(time.Duration(index) * time.Second),
			Action:     "upload",
			VideoID:    "V1",
			TargetPath: "movie.zh.srt",
			Status:     "ok",
		}
		if err := st.AppendLog(item); err != nil {
			t.Fatalf("append log %d: %v", index, err)
		}
	}

	firstPage, total, err := st.ListLogs(1, 2)
	if err != nil {
		t.Fatalf("list first page: %v", err)
	}
	if total != 3 {
		t.Fatalf("expected total=3, got %d", total)
	}
	if len(firstPage) != 2 {
		t.Fatalf("expected 2 logs on first page, got %d", len(firstPage))
	}
	if firstPage[0].ID != "L3" || firstPage[1].ID != "L2" {
		t.Fatalf("unexpected first page order: %q, %q", firstPage[0].ID, firstPage[1].ID)
	}

	secondPage, total, err := st.ListLogs(2, 2)
	if err != nil {
		t.Fatalf("list second page: %v", err)
	}
	if total != 3 {
		t.Fatalf("expected total=3 on second page, got %d", total)
	}
	if len(secondPage) != 1 || secondPage[0].ID != "L1" {
		t.Fatalf("unexpected second page: %+v", secondPage)
	}

	if err := st.ClearLogs(); err != nil {
		t.Fatalf("clear logs: %v", err)
	}

	afterClear, total, err := st.ListLogs(1, 2)
	if err != nil {
		t.Fatalf("list after clear: %v", err)
	}
	if total != 0 || len(afterClear) != 0 {
		t.Fatalf("expected no logs after clear, total=%d len=%d", total, len(afterClear))
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
