package subtitle

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func languageFixturePath(t *testing.T, name string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// backend/internal/subtitle -> repo root
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "../../.."))
	return filepath.Join(root, "testdata", "language", name)
}

func loadLanguageFixture[T any](t *testing.T, name string) []T {
	t.Helper()
	data, err := os.ReadFile(languageFixturePath(t, name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var out []T
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("parse fixture %s: %v", name, err)
	}
	return out
}

func TestContractBilingualFlags(t *testing.T) {
	type row struct {
		Input string `json:"input"`
		Want  bool   `json:"want"`
	}
	for _, tt := range loadLanguageFixture[row](t, "bilingual_flags.json") {
		if got := IsBilingualLanguage(tt.Input); got != tt.Want {
			t.Fatalf("IsBilingualLanguage(%q)=%v want %v", tt.Input, got, tt.Want)
		}
	}
}

func TestContractDetectType(t *testing.T) {
	type row struct {
		Input string `json:"input"`
		Want  string `json:"want"`
	}
	for _, tt := range loadLanguageFixture[row](t, "detect_type.json") {
		if got := DetectLanguageType(tt.Input); got != tt.Want {
			t.Fatalf("DetectLanguageType(%q)=%q want %q", tt.Input, got, tt.Want)
		}
	}
}

func TestContractNameLabels(t *testing.T) {
	type row struct {
		Input     string `json:"input"`
		WantLabel string `json:"wantLabel"`
	}
	for _, tt := range loadLanguageFixture[row](t, "name_labels.json") {
		if got := LabelFromFileName(tt.Input); got != tt.WantLabel {
			t.Fatalf("LabelFromFileName(%q)=%q want %q", tt.Input, got, tt.WantLabel)
		}
	}
}
