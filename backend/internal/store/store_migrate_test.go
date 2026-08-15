package store

import (
	"database/sql"
	"sync"
	"testing"

	"subtitle-ui/backend/internal/domain"
)

func TestConcurrentOpenAppliesMigrationsOnce(t *testing.T) {
	dsn := TestDSN(t)

	const workers = 8
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	stores := make(chan *Store, workers)
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			st, err := Open(dsn)
			if err != nil {
				errs <- err
				return
			}
			stores <- st
		}()
	}
	wg.Wait()
	close(errs)
	close(stores)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent open: %v", err)
		}
	}

	opened := 0
	for st := range stores {
		opened++
		if err := st.Ping(nil); err != nil {
			t.Fatalf("ping after concurrent migrate: %v", err)
		}
		_ = st.Close()
	}
	if opened != workers {
		t.Fatalf("expected %d successful opens, got %d", workers, opened)
	}

	verify, err := Open(dsn)
	if err != nil {
		t.Fatalf("reopen after concurrent migrate: %v", err)
	}
	defer func() {
		_ = verify.Close()
	}()
	for version := 1; version <= 10; version++ {
		applied, err := verify.isMigrationApplied(version)
		if err != nil {
			t.Fatalf("check migration v%d: %v", version, err)
		}
		if !applied {
			t.Fatalf("expected migration v%d to be applied", version)
		}
	}
}

func TestMigrateUpgradesExistingPostgresSchema(t *testing.T) {
	db, err := sql.Open("pgx", TestDSN(t))
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer func() { _ = db.Close() }()

	st := &Store{db: db}
	if _, err := st.exec(`CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`); err != nil {
		t.Fatalf("create schema migrations: %v", err)
	}
	for version, script := range []string{migrationV1, migrationV2, migrationV3, migrationV4} {
		if err := st.execScript(script); err != nil {
			t.Fatalf("apply legacy migration v%d: %v", version+1, err)
		}
		if _, err := st.exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, version+1, "2024-01-01T00:00:00Z"); err != nil {
			t.Fatalf("mark legacy migration v%d: %v", version+1, err)
		}
	}

	if _, err := st.exec(`INSERT INTO videos(id, path, directory, file_name, title, year, metadata_source, updated_at, media_type, poster_path)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"V1", "/media/movie.mkv", "/media", "movie.mkv", "电影", "2024", "nfo", "2024-01-01T00:00:00Z", "movie", "",
	); err != nil {
		t.Fatalf("insert legacy video: %v", err)
	}
	for _, sub := range []struct {
		id, path, file string
	}{
		{id: "S1", path: "/media/movie.zh.srt", file: "movie.zh.srt"},
		{id: "S2", path: "/media/movie.zh.ass", file: "movie.zh.ass"},
	} {
		if _, err := st.exec(`INSERT INTO subtitles(id, video_id, path, file_name, language, format, size, mod_time, updated_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sub.id, "V1", sub.path, sub.file, "zh", "srt", 12, "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z",
		); err != nil {
			t.Fatalf("insert legacy subtitle %s: %v", sub.id, err)
		}
	}
	for _, item := range []struct {
		id, timestamp, action, target, message string
	}{
		{id: "L1", timestamp: "2024-01-01T00:00:01Z", action: "upload", target: "/media/movie.zh.srt"},
		{id: "L2", timestamp: "2024-01-01T00:00:02Z", action: "convert", target: "/media/movie.zh.ass", message: "generated from movie.zh.srt"},
	} {
		if _, err := st.exec(`INSERT INTO operation_logs(id, timestamp, action, video_id, target_path, backup_path, status, message)
VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			item.id, item.timestamp, item.action, "V1", item.target, "", "ok", item.message,
		); err != nil {
			t.Fatalf("insert legacy log %s: %v", item.id, err)
		}
	}

	if err := st.migrate(); err != nil {
		t.Fatalf("migrate legacy postgres schema: %v", err)
	}

	for _, expected := range []struct {
		id, source, detail string
	}{
		{id: "S1", source: domain.SubtitleSourceUpload, detail: "movie.zh.srt"},
		{id: "S2", source: domain.SubtitleSourceGenerated, detail: "movie.zh.srt"},
	} {
		var source, detail string
		if err := st.queryRow(`SELECT source, source_detail FROM subtitles WHERE id = ?`, expected.id).Scan(&source, &detail); err != nil {
			t.Fatalf("read migrated subtitle %s: %v", expected.id, err)
		}
		if source != expected.source || detail != expected.detail {
			t.Fatalf("subtitle %s source=%q detail=%q, want %q/%q", expected.id, source, detail, expected.source, expected.detail)
		}
	}
	for _, column := range []struct{ table, name string }{
		{table: "videos", name: "original_title"},
		{table: "videos", name: "title_sort_key"},
		{table: "videos", name: "file_size"},
		{table: "operation_logs", name: "meta"},
	} {
		has, err := st.hasColumn(column.table, column.name)
		if err != nil {
			t.Fatalf("check %s.%s: %v", column.table, column.name, err)
		}
		if !has {
			t.Fatalf("expected migrated column %s.%s", column.table, column.name)
		}
	}
	var sortKey string
	if err := st.queryRow(`SELECT title_sort_key FROM videos WHERE id = ?`, "V1").Scan(&sortKey); err != nil {
		t.Fatalf("read title sort key: %v", err)
	}
	if sortKey == "" {
		t.Fatal("expected title_sort_key backfill")
	}
}
