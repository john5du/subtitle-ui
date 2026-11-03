package scanner

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDirIndexRetriesTransientStatAndReadErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "movie.nfo")
	if err := os.WriteFile(path, []byte("nfo"), 0o644); err != nil {
		t.Fatal(err)
	}

	statCalls := 0
	idx := newDirIndex(os.ReadDir)
	idx.statPath = func(name string) (os.FileInfo, error) {
		statCalls++
		if statCalls == 1 {
			return nil, os.ErrPermission
		}
		return os.Stat(name)
	}
	if _, err := idx.stat(path); !errors.Is(err, os.ErrPermission) {
		t.Fatalf("first stat: %v", err)
	}
	info, err := idx.stat(path)
	if err != nil || info == nil || info.IsDir() {
		t.Fatalf("retry stat: info=%v err=%v", info, err)
	}
	if statCalls != 2 {
		t.Fatalf("stat calls=%d, want 2", statCalls)
	}

	readCalls := 0
	idx = newDirIndex(func(name string) ([]os.DirEntry, error) {
		readCalls++
		if readCalls == 1 {
			return nil, os.ErrPermission
		}
		return os.ReadDir(name)
	})
	if _, err := idx.snap(dir); !errors.Is(err, os.ErrPermission) {
		t.Fatalf("first read: %v", err)
	}
	if _, err := idx.snap(dir); err != nil {
		t.Fatalf("retry read: %v", err)
	}
	if readCalls != 2 {
		t.Fatalf("read calls=%d, want 2", readCalls)
	}
}

func TestDirIndexCachesMissingStat(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.nfo")
	calls := 0
	idx := newDirIndex(os.ReadDir)
	idx.statPath = func(string) (os.FileInfo, error) {
		calls++
		return nil, os.ErrNotExist
	}
	if _, err := idx.stat(missing); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("first: %v", err)
	}
	if _, err := idx.stat(missing); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("second: %v", err)
	}
	if calls != 1 {
		t.Fatalf("stat calls=%d, want 1", calls)
	}
}
