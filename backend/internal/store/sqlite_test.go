package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
		ID:                  "V1",
		Path:                filepath.Join(t.TempDir(), "movie.mkv"),
		Directory:           filepath.Join(t.TempDir(), "dir"),
		FileName:            "movie.mkv",
		Title:               "Movie",
		OriginalTitle:       "Movie Original",
		Year:                "2025",
		ImdbID:              "tt7654321",
		TmdbID:              "12345",
		MediaType:           domain.MediaTypeMovie,
		MetadataSource:      "nfo",
		SeriesTitle:         "Series Local",
		SeriesOriginalTitle: "Series Original",
		SeriesImdbID:        "tt1111111",
		SeriesTmdbID:        "67890",
		PosterPath:          filepath.Join(t.TempDir(), "dir", "poster.jpg"),
		FileSize:            23836844941,
		UpdatedAt:           now,
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

	if err := st.SaveScanResult([]domain.Video{video}, now, now.Add(time.Second), "", nil); err != nil {
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
	if videos[0].OriginalTitle != video.OriginalTitle || videos[0].ImdbID != video.ImdbID || videos[0].TmdbID != video.TmdbID {
		t.Fatalf("unexpected movie metadata fields: %+v", videos[0])
	}
	if videos[0].SeriesTitle != video.SeriesTitle || videos[0].SeriesOriginalTitle != video.SeriesOriginalTitle ||
		videos[0].SeriesImdbID != video.SeriesImdbID || videos[0].SeriesTmdbID != video.SeriesTmdbID {
		t.Fatalf("unexpected series metadata fields: %+v", videos[0])
	}

	matches, total, err := st.ListVideos("Original", domain.MediaTypeMovie, "", 1, 20, "", "")
	if err != nil {
		t.Fatalf("list videos by original title: %v", err)
	}
	if total != 1 || len(matches) != 1 || matches[0].ID != video.ID {
		t.Fatalf("expected original title query to match stored video, total=%d matches=%+v", total, matches)
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
	if storedVideo.FileSize != video.FileSize {
		t.Fatalf("expected stored file size %d, got %d", video.FileSize, storedVideo.FileSize)
	}
	if storedVideo.OriginalTitle != video.OriginalTitle || storedVideo.ImdbID != video.ImdbID || storedVideo.TmdbID != video.TmdbID {
		t.Fatalf("unexpected stored movie metadata fields: %+v", storedVideo)
	}
	if storedVideo.SeriesTitle != video.SeriesTitle || storedVideo.SeriesOriginalTitle != video.SeriesOriginalTitle ||
		storedVideo.SeriesImdbID != video.SeriesImdbID || storedVideo.SeriesTmdbID != video.SeriesTmdbID {
		t.Fatalf("unexpected stored series metadata fields: %+v", storedVideo)
	}
	if storedVideo.Subtitles[0].Source != domain.SubtitleSourceUpload || storedVideo.Subtitles[0].SourceDetail != "upload.zh.srt" {
		t.Fatalf("expected stored subtitle source to be preserved, got %+v", storedVideo.Subtitles[0])
	}

	rescanned := video
	rescanned.Subtitles[0].Source = domain.SubtitleSourceDirectory
	rescanned.Subtitles[0].SourceDetail = ""
	if err := st.SaveScanResult([]domain.Video{rescanned}, now.Add(2*time.Second), now.Add(3*time.Second), "", nil); err != nil {
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
		`CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  directory TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  year TEXT NOT NULL DEFAULT '',
  metadata_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie',
  poster_path TEXT NOT NULL DEFAULT ''
)`,
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

func TestMigrationV6AddsVideoMetadataColumns(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy-v6.sqlite3")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	statements := []string{
		`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
		`INSERT INTO schema_migrations(version, applied_at) VALUES(1, '` + now + `'), (2, '` + now + `'), (3, '` + now + `'), (4, '` + now + `'), (5, '` + now + `')`,
		`CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  directory TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  year TEXT NOT NULL DEFAULT '',
  metadata_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie',
  poster_path TEXT NOT NULL DEFAULT ''
)`,
		`INSERT INTO videos(id, path, directory, file_name, title, year, metadata_source, updated_at, media_type, poster_path)
VALUES('V1', '/media/movie.mkv', '/media', 'movie.mkv', 'Movie', '2025', 'nfo', '` + now + `', 'movie', '')`,
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

	row := st.db.QueryRow(`SELECT original_title, imdb_id, tmdb_id, series_title, series_original_title, series_imdb_id, series_tmdb_id FROM videos WHERE id = 'V1'`)
	var originalTitle, imdbID, tmdbID, seriesTitle, seriesOriginalTitle, seriesImdbID, seriesTmdbID string
	if err := row.Scan(&originalTitle, &imdbID, &tmdbID, &seriesTitle, &seriesOriginalTitle, &seriesImdbID, &seriesTmdbID); err != nil {
		t.Fatalf("query migrated video metadata columns: %v", err)
	}
	if originalTitle != "" || imdbID != "" || tmdbID != "" || seriesTitle != "" || seriesOriginalTitle != "" || seriesImdbID != "" || seriesTmdbID != "" {
		t.Fatalf("expected empty defaults after migration, got original=%q imdb=%q tmdb=%q series=%q/%q/%q/%q",
			originalTitle, imdbID, tmdbID, seriesTitle, seriesOriginalTitle, seriesImdbID, seriesTmdbID)
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

func TestSaveScanResultScopedReplaceKeepsOutOfScopeVideos(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "scoped.sqlite3")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	now := time.Now().UTC()
	movieRoot := filepath.Join(t.TempDir(), "movies")
	keepDir := filepath.Join(movieRoot, "Keep Movie")
	replaceDir := filepath.Join(movieRoot, "Replace Movie")
	keepVideo := domain.Video{
		ID:             "KEEP",
		Path:           filepath.Join(keepDir, "keep.mkv"),
		Directory:      keepDir,
		FileName:       "keep.mkv",
		Title:          "Keep Movie",
		Year:           "2024",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:       "KEEP-S",
				Path:     filepath.Join(keepDir, "keep.zh.srt"),
				FileName: "keep.zh.srt",
				Language: "zh",
				Format:   "srt",
				Size:     10,
				ModTime:  now,
				Source:   domain.SubtitleSourceDirectory,
			},
		},
	}
	oldReplace := domain.Video{
		ID:             "REPLACE-OLD",
		Path:           filepath.Join(replaceDir, "old.mkv"),
		Directory:      replaceDir,
		FileName:       "old.mkv",
		Title:          "Replace Movie Old",
		Year:           "2023",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:       "REPLACE-OLD-S",
				Path:     filepath.Join(replaceDir, "old.zh.srt"),
				FileName: "old.zh.srt",
				Language: "zh",
				Format:   "srt",
				Size:     11,
				ModTime:  now,
				Source:   domain.SubtitleSourceDirectory,
			},
		},
	}
	if err := st.SaveScanResult([]domain.Video{keepVideo, oldReplace}, now, now.Add(time.Second), "", nil); err != nil {
		t.Fatalf("seed scan: %v", err)
	}

	newReplace := domain.Video{
		ID:             "REPLACE-NEW",
		Path:           filepath.Join(replaceDir, "new.mkv"),
		Directory:      replaceDir,
		FileName:       "new.mkv",
		Title:          "Replace Movie New",
		Year:           "2025",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      now.Add(2 * time.Second),
		Subtitles: []domain.Subtitle{
			{
				ID:       "REPLACE-NEW-S",
				Path:     filepath.Join(replaceDir, "new.zh.srt"),
				FileName: "new.zh.srt",
				Language: "zh",
				Format:   "srt",
				Size:     12,
				ModTime:  now.Add(2 * time.Second),
				Source:   domain.SubtitleSourceDirectory,
			},
		},
	}
	if err := st.SaveScanResult([]domain.Video{newReplace}, now.Add(2*time.Second), now.Add(3*time.Second), "", []string{replaceDir}); err != nil {
		t.Fatalf("scoped scan: %v", err)
	}

	videos, total, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "year", "desc")
	if err != nil {
		t.Fatalf("list videos: %v", err)
	}
	if total != 2 {
		t.Fatalf("expected total=2 after scoped replace, got %d", total)
	}
	ids := map[string]bool{}
	for _, video := range videos {
		ids[video.ID] = true
	}
	if !ids["KEEP"] || !ids["REPLACE-NEW"] || ids["REPLACE-OLD"] {
		t.Fatalf("unexpected video ids after scoped replace: %+v", ids)
	}
	kept, found, err := st.GetVideo("KEEP")
	if err != nil || !found {
		t.Fatalf("expected keep video to remain: found=%v err=%v", found, err)
	}
	if len(kept.Subtitles) != 1 || kept.Subtitles[0].ID != "KEEP-S" {
		t.Fatalf("expected keep subtitle preserved, got %+v", kept.Subtitles)
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

	if err := st.SaveScanResult(videos, now, now, "", nil); err != nil {
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

func TestListVideosSortByChinesePinyinTitle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sort-pinyin.sqlite3")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	now := time.Now().UTC()
	tempDir := t.TempDir()
	videos := []domain.Video{
		{ID: "1", Path: filepath.Join(tempDir, "1.mkv"), Directory: tempDir, FileName: "1.mkv", Title: "长津湖", Year: "2021", MediaType: domain.MediaTypeMovie, MetadataSource: "nfo", UpdatedAt: now},
		{ID: "2", Path: filepath.Join(tempDir, "2.mkv"), Directory: tempDir, FileName: "2.mkv", Title: "阿凡达", Year: "2009", MediaType: domain.MediaTypeMovie, MetadataSource: "nfo", UpdatedAt: now},
		{ID: "3", Path: filepath.Join(tempDir, "3.mkv"), Directory: tempDir, FileName: "3.mkv", Title: "霸王别姬", Year: "1993", MediaType: domain.MediaTypeMovie, MetadataSource: "nfo", UpdatedAt: now},
		{ID: "4", Path: filepath.Join(tempDir, "4.mkv"), Directory: tempDir, FileName: "4.mkv", Title: "Batman", Year: "2022", MediaType: domain.MediaTypeMovie, MetadataSource: "nfo", UpdatedAt: now},
	}
	if err := st.SaveScanResult(videos, now, now, "", nil); err != nil {
		t.Fatalf("save scan result: %v", err)
	}

	asc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "title", "asc")
	if err != nil {
		t.Fatalf("list by title asc: %v", err)
	}
	got := titlesOf(asc)
	if len(got) != 4 {
		t.Fatalf("expected 4 videos, got %v", got)
	}
	idxA := indexOf(got, "阿凡达")
	idxBatman := indexOf(got, "Batman")
	idxBa := indexOf(got, "霸王别姬")
	idxChang := indexOf(got, "长津湖")
	if idxA < 0 || idxBatman < 0 || idxBa < 0 || idxChang < 0 {
		t.Fatalf("missing titles in %v", got)
	}
	// afanda < batman < bawangbieji; 长 is later pinyin than 阿
	if !(idxA < idxBatman && idxBatman < idxBa && idxA < idxChang) {
		t.Fatalf("unexpected pinyin order: %v", got)
	}
}

func indexOf(items []string, value string) int {
	for i, item := range items {
		if item == value {
			return i
		}
	}
	return -1
}

func TestListVideosSortByTitleUpdatedAtSubtitleCount(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sort-multi.sqlite3")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	tempDir := t.TempDir()
	videos := []domain.Video{
		{
			ID:             "A",
			Path:           filepath.Join(tempDir, "a.mkv"),
			Directory:      tempDir,
			FileName:       "a.mkv",
			Title:          "Charlie",
			Year:           "2020",
			MediaType:      domain.MediaTypeMovie,
			MetadataSource: "nfo",
			UpdatedAt:      base.Add(2 * time.Hour),
			Subtitles: []domain.Subtitle{
				{ID: "sa1", Path: filepath.Join(tempDir, "a.en.srt"), FileName: "a.en.srt", Language: "en", Format: "srt", Source: "directory"},
			},
		},
		{
			ID:             "B",
			Path:           filepath.Join(tempDir, "b.mkv"),
			Directory:      tempDir,
			FileName:       "b.mkv",
			Title:          "Alpha",
			Year:           "2021",
			MediaType:      domain.MediaTypeMovie,
			MetadataSource: "nfo",
			UpdatedAt:      base.Add(1 * time.Hour),
			Subtitles: []domain.Subtitle{
				{ID: "sb1", Path: filepath.Join(tempDir, "b.en.srt"), FileName: "b.en.srt", Language: "en", Format: "srt", Source: "directory"},
				{ID: "sb2", Path: filepath.Join(tempDir, "b.zh.srt"), FileName: "b.zh.srt", Language: "zh", Format: "srt", Source: "directory"},
			},
		},
		{
			ID:             "C",
			Path:           filepath.Join(tempDir, "c.mkv"),
			Directory:      tempDir,
			FileName:       "c.mkv",
			Title:          "Bravo",
			Year:           "2022",
			MediaType:      domain.MediaTypeMovie,
			MetadataSource: "nfo",
			UpdatedAt:      base.Add(3 * time.Hour),
		},
	}

	if err := st.SaveScanResult(videos, base, base, "", nil); err != nil {
		t.Fatalf("save scan result: %v", err)
	}

	byTitleAsc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "title", "asc")
	if err != nil {
		t.Fatalf("list by title asc: %v", err)
	}
	if got := titlesOf(byTitleAsc); !equalStrings(got, []string{"Alpha", "Bravo", "Charlie"}) {
		t.Fatalf("unexpected title asc order: %v", got)
	}

	byTitleDesc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "title", "desc")
	if err != nil {
		t.Fatalf("list by title desc: %v", err)
	}
	if got := titlesOf(byTitleDesc); !equalStrings(got, []string{"Charlie", "Bravo", "Alpha"}) {
		t.Fatalf("unexpected title desc order: %v", got)
	}

	byUpdatedDesc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "updatedAt", "desc")
	if err != nil {
		t.Fatalf("list by updatedAt desc: %v", err)
	}
	if got := titlesOf(byUpdatedDesc); !equalStrings(got, []string{"Bravo", "Charlie", "Alpha"}) {
		t.Fatalf("unexpected updatedAt desc order: %v", got)
	}

	bySubDesc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "subtitleCount", "desc")
	if err != nil {
		t.Fatalf("list by subtitleCount desc: %v", err)
	}
	if got := titlesOf(bySubDesc); !equalStrings(got, []string{"Alpha", "Charlie", "Bravo"}) {
		t.Fatalf("unexpected subtitleCount desc order: %v", got)
	}

	bySubAsc, _, err := st.ListVideos("", domain.MediaTypeMovie, "", 1, 20, "subtitleCount", "asc")
	if err != nil {
		t.Fatalf("list by subtitleCount asc: %v", err)
	}
	if got := titlesOf(bySubAsc); !equalStrings(got, []string{"Bravo", "Charlie", "Alpha"}) {
		t.Fatalf("unexpected subtitleCount asc order: %v", got)
	}
}

func titlesOf(videos []domain.Video) []string {
	out := make([]string, 0, len(videos))
	for _, video := range videos {
		out = append(out, video.Title)
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestOpenWithOptionsDefaultsToSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "options.sqlite3")
	st, err := OpenWithOptions(OpenOptions{SQLitePath: dbPath})
	if err != nil {
		t.Fatalf("open sqlite with options: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	if st.dialect != dialectSQLite {
		t.Fatalf("expected sqlite dialect, got %s", st.dialect)
	}
	if st.DatabaseType() != string(dialectSQLite) {
		t.Fatalf("expected sqlite database type, got %s", st.DatabaseType())
	}
}

func TestPostgresStoreScanSettingsAndLogs(t *testing.T) {
	dsn := postgresTestDSN(t)
	st, err := OpenWithOptions(OpenOptions{
		PostgresURL: dsn,
		SQLitePath:  filepath.Join(t.TempDir(), "missing.sqlite3"),
	})
	if err != nil {
		t.Fatalf("open postgres store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()
	if st.DatabaseType() != string(dialectPostgres) {
		t.Fatalf("expected postgres database type, got %s", st.DatabaseType())
	}

	now := time.Now().UTC()
	video := domain.Video{
		ID:             "PGV1",
		Path:           "/media/pg/movie.mkv",
		Directory:      "/media/pg",
		FileName:       "movie.mkv",
		Title:          "Postgres Movie",
		OriginalTitle:  "Postgres Original",
		Year:           "2026",
		ImdbID:         "tt0000001",
		TmdbID:         "1001",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		PosterPath:     "/media/pg/poster.jpg",
		FileSize:       23836844941,
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:           "PGS1",
				Path:         "/media/pg/movie.zh.srt",
				FileName:     "movie.zh.srt",
				Language:     "zh",
				Format:       "srt",
				Size:         42,
				ModTime:      now,
				Source:       domain.SubtitleSourceUpload,
				SourceDetail: "movie.zh.srt",
			},
		},
	}

	if err := st.SaveScanResult([]domain.Video{video}, now, now.Add(time.Second), "", nil); err != nil {
		t.Fatalf("save pg scan result: %v", err)
	}
	storedPG, foundPG, err := st.GetVideo(video.ID)
	if err != nil {
		t.Fatalf("get pg video: %v", err)
	}
	if !foundPG {
		t.Fatalf("expected pg video to exist")
	}
	if storedPG.FileSize != video.FileSize {
		t.Fatalf("expected pg file size %d, got %d", video.FileSize, storedPG.FileSize)
	}
	matches, total, err := st.ListVideos("original", domain.MediaTypeMovie, "", 1, 20, "year", "desc")
	if err != nil {
		t.Fatalf("list pg videos: %v", err)
	}
	if total != 1 || len(matches) != 1 || matches[0].ID != video.ID {
		t.Fatalf("unexpected pg video results: total=%d rows=%+v", total, matches)
	}
	if len(matches[0].Subtitles) != 1 || matches[0].Subtitles[0].Source != domain.SubtitleSourceUpload {
		t.Fatalf("unexpected pg subtitles: %+v", matches[0].Subtitles)
	}

	if err := st.SetAppSettings(map[string]string{"subtitle_conversion.source_encoding_default": "gb18030"}, now); err != nil {
		t.Fatalf("set pg app settings: %v", err)
	}
	settings, err := st.GetAppSettings([]string{"subtitle_conversion.source_encoding_default"})
	if err != nil {
		t.Fatalf("get pg app settings: %v", err)
	}
	if settings["subtitle_conversion.source_encoding_default"].Value != "gb18030" {
		t.Fatalf("unexpected pg setting: %+v", settings)
	}

	if err := st.AppendLog(domain.OperationLog{
		ID:         "PGL1",
		Timestamp:  now,
		Action:     "upload",
		VideoID:    video.ID,
		TargetPath: "/media/pg/movie.zh.srt",
		Status:     "ok",
	}); err != nil {
		t.Fatalf("append pg log: %v", err)
	}
	logs, total, err := st.ListLogs(1, 20)
	if err != nil {
		t.Fatalf("list pg logs: %v", err)
	}
	if total != 1 || len(logs) != 1 || logs[0].ID != "PGL1" {
		t.Fatalf("unexpected pg logs: total=%d rows=%+v", total, logs)
	}
}

func TestPostgresSaveScanResultUpsertsDuplicateScanRows(t *testing.T) {
	dsn := postgresTestDSN(t)
	st, err := OpenWithOptions(OpenOptions{
		PostgresURL: dsn,
		SQLitePath:  filepath.Join(t.TempDir(), "missing.sqlite3"),
	})
	if err != nil {
		t.Fatalf("open postgres store: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	now := time.Now().UTC()
	video := domain.Video{
		ID:             "DUPV1",
		Path:           "/media/dup/movie.mkv",
		Directory:      "/media/dup",
		FileName:       "movie.mkv",
		Title:          "Duplicate Movie",
		Year:           "2025",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:       "DUPS1",
				Path:     "/media/dup/movie.zh.srt",
				FileName: "movie.zh.srt",
				Language: "zh",
				Format:   "srt",
				Size:     10,
				ModTime:  now,
				Source:   domain.SubtitleSourceDirectory,
			},
		},
	}
	duplicate := video
	duplicate.MediaType = domain.MediaTypeTV
	duplicate.Title = "Duplicate Movie TV"
	duplicate.Subtitles = []domain.Subtitle{video.Subtitles[0]}
	duplicate.Subtitles[0].Size = 20

	if err := st.SaveScanResult([]domain.Video{video, duplicate}, now, now.Add(time.Second), "", nil); err != nil {
		t.Fatalf("save duplicate pg scan result: %v", err)
	}
	got, found, err := st.GetVideo(video.ID)
	if err != nil {
		t.Fatalf("get duplicate pg video: %v", err)
	}
	if !found {
		t.Fatalf("expected duplicate pg video to exist")
	}
	if got.MediaType != domain.MediaTypeTV || got.Title != duplicate.Title {
		t.Fatalf("expected last duplicate video to win, got %+v", got)
	}
	if len(got.Subtitles) != 1 || got.Subtitles[0].Size != 20 {
		t.Fatalf("expected last duplicate subtitle to win, got %+v", got.Subtitles)
	}
}

func TestPostgresMigratesInitialSQLiteDataOnce(t *testing.T) {
	dsn := postgresTestDSN(t)
	sqlitePath := filepath.Join(t.TempDir(), "source.sqlite3")

	source, err := Open(sqlitePath)
	if err != nil {
		t.Fatalf("open sqlite source: %v", err)
	}
	now := time.Now().UTC()
	sourceVideo := domain.Video{
		ID:             "SRCV1",
		Path:           "/media/source/movie.mkv",
		Directory:      "/media/source",
		FileName:       "movie.mkv",
		Title:          "Source Movie",
		Year:           "2025",
		MediaType:      domain.MediaTypeMovie,
		MetadataSource: "nfo",
		UpdatedAt:      now,
		Subtitles: []domain.Subtitle{
			{
				ID:       "SRCS1",
				Path:     "/media/source/movie.en.srt",
				FileName: "movie.en.srt",
				Language: "en",
				Format:   "srt",
				Size:     10,
				ModTime:  now,
			},
		},
	}
	if err := source.SaveScanResult([]domain.Video{sourceVideo}, now, now.Add(time.Second), "", nil); err != nil {
		t.Fatalf("seed sqlite scan result: %v", err)
	}
	if err := source.AppendLog(domain.OperationLog{
		ID:         "SRCL1",
		Timestamp:  now,
		Action:     "upload",
		VideoID:    sourceVideo.ID,
		TargetPath: "/media/source/movie.en.srt",
		Status:     "ok",
	}); err != nil {
		t.Fatalf("seed sqlite log: %v", err)
	}
	if err := source.SetAppSettings(map[string]string{"subtitle_conversion.source_encoding_default": "utf-8"}, now); err != nil {
		t.Fatalf("seed sqlite setting: %v", err)
	}
	if err := source.Close(); err != nil {
		t.Fatalf("close sqlite source: %v", err)
	}

	st, err := OpenWithOptions(OpenOptions{PostgresURL: dsn, SQLitePath: sqlitePath})
	if err != nil {
		t.Fatalf("open postgres with sqlite migration: %v", err)
	}
	video, found, err := st.GetVideo(sourceVideo.ID)
	if err != nil {
		t.Fatalf("get migrated video: %v", err)
	}
	if !found || video.Title != sourceVideo.Title || len(video.Subtitles) != 1 {
		t.Fatalf("unexpected migrated video: found=%v video=%+v", found, video)
	}
	logs, total, err := st.ListLogs(1, 20)
	if err != nil {
		t.Fatalf("list migrated logs: %v", err)
	}
	if total != 1 || len(logs) != 1 || logs[0].ID != "SRCL1" {
		t.Fatalf("unexpected migrated logs: total=%d rows=%+v", total, logs)
	}
	settings, err := st.GetAppSettings([]string{"subtitle_conversion.source_encoding_default"})
	if err != nil {
		t.Fatalf("get migrated setting: %v", err)
	}
	if settings["subtitle_conversion.source_encoding_default"].Value != "utf-8" {
		t.Fatalf("unexpected migrated setting: %+v", settings)
	}
	backups, err := filepath.Glob(sqlitePath + ".backup-*")
	if err != nil {
		t.Fatalf("glob sqlite backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("expected one sqlite backup, got %d: %v", len(backups), backups)
	}
	backupDB, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatalf("open sqlite backup: %v", err)
	}
	var backupTitle string
	if err := backupDB.QueryRow(`SELECT title FROM videos WHERE id = ?`, sourceVideo.ID).Scan(&backupTitle); err != nil {
		_ = backupDB.Close()
		t.Fatalf("query sqlite backup: %v", err)
	}
	if err := backupDB.Close(); err != nil {
		t.Fatalf("close sqlite backup: %v", err)
	}
	if backupTitle != sourceVideo.Title {
		t.Fatalf("expected backup title %q, got %q", sourceVideo.Title, backupTitle)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close migrated pg store: %v", err)
	}

	st, err = OpenWithOptions(OpenOptions{PostgresURL: dsn, SQLitePath: sqlitePath})
	if err != nil {
		t.Fatalf("reopen postgres after sqlite migration: %v", err)
	}
	defer func() {
		_ = st.Close()
	}()

	if err := st.SaveScanResult([]domain.Video{sourceVideo}, now.Add(2*time.Second), now.Add(3*time.Second), "", nil); err != nil {
		t.Fatalf("save after migration: %v", err)
	}
	row := st.queryRow(`SELECT MAX(id) FROM scan_runs`)
	var maxID int
	if err := row.Scan(&maxID); err != nil {
		t.Fatalf("query scan run max id: %v", err)
	}
	if maxID != 2 {
		t.Fatalf("expected scan_runs identity to continue at 2, got %d", maxID)
	}
}

func TestPostgresInitialImportRefusesNonEmptyTargetWithoutMarker(t *testing.T) {
	dsn := postgresTestDSN(t)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open raw postgres: %v", err)
	}
	prepared := &Store{db: db, dialect: dialectPostgres}
	if err := prepared.migrate(); err != nil {
		_ = db.Close()
		t.Fatalf("prepare pg schema: %v", err)
	}
	if _, err := prepared.exec(
		`INSERT INTO videos(id, path, directory, file_name, title, original_title, year, imdb_id, tmdb_id, media_type, metadata_source, series_title, series_original_title, series_imdb_id, series_tmdb_id, poster_path, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"EXISTING",
		"/media/existing.mkv",
		"/media",
		"existing.mkv",
		"Existing",
		"",
		"2024",
		"",
		"",
		domain.MediaTypeMovie,
		"nfo",
		"",
		"",
		"",
		"",
		"",
		time.Now().UTC().Format(time.RFC3339Nano),
	); err != nil {
		_ = db.Close()
		t.Fatalf("seed pg target: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close raw postgres: %v", err)
	}

	_, err = OpenWithOptions(OpenOptions{
		PostgresURL: dsn,
		SQLitePath:  filepath.Join(t.TempDir(), "missing.sqlite3"),
	})
	if err == nil {
		t.Fatalf("expected non-empty pg target to reject sqlite import")
	}
	if !strings.Contains(err.Error(), "already contains") {
		t.Fatalf("expected non-empty target error, got %v", err)
	}
}

func postgresTestDSN(t *testing.T) string {
	t.Helper()

	base := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if base == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}

	schema := fmt.Sprintf("subtitle_ui_test_%s_%d", sanitizePostgresIdentifier(t.Name()), time.Now().UnixNano())
	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatalf("open postgres admin connection: %v", err)
	}
	quotedSchema := quotePostgresIdentifier(schema)
	if _, err := admin.Exec(`CREATE SCHEMA ` + quotedSchema); err != nil {
		_ = admin.Close()
		t.Fatalf("create postgres test schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(`DROP SCHEMA IF EXISTS ` + quotedSchema + ` CASCADE`)
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

func sanitizePostgresIdentifier(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(raw) {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "store"
	}
	return out
}

func quotePostgresIdentifier(raw string) string {
	return `"` + strings.ReplaceAll(raw, `"`, `""`) + `"`
}
