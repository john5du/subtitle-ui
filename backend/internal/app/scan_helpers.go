package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"subtitle-ui/backend/internal/domain"
)

func mergeScanScopes(scopes ...[]string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0)
	for _, group := range scopes {
		for _, scope := range group {
			cleaned := filepath.Clean(strings.TrimSpace(scope))
			if cleaned == "" || cleaned == "." {
				continue
			}
			key := strings.ToLower(cleaned)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, cleaned)
		}
	}
	return out
}

func cloneDirectoryScanResult(result domain.DirectoryScanResult) domain.DirectoryScanResult {
	cloned := result
	cloned.Movie = append([]domain.ScanDirectory(nil), result.Movie...)
	cloned.TV = append([]domain.ScanDirectory(nil), result.TV...)
	cloned.Errors = append([]string(nil), result.Errors...)
	return cloned
}

func prefixedError(prefix string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", prefix, err)
}

func combineErrors(errs ...error) error {
	parts := make([]string, 0, len(errs))
	for _, err := range errs {
		if err == nil {
			continue
		}
		parts = append(parts, err.Error())
	}
	if len(parts) == 0 {
		return nil
	}
	return errors.New(strings.Join(parts, "; "))
}

func sameFilePath(a string, b string) bool {
	left := filepath.Clean(strings.TrimSpace(a))
	right := filepath.Clean(strings.TrimSpace(b))
	return strings.EqualFold(left, right)
}

func ensureDirectoryWritable(root string) error {
	file, err := os.CreateTemp(root, ".subtitle-ui-write-check-*")
	if err != nil {
		return err
	}

	name := file.Name()
	closeErr := file.Close()
	removeErr := os.Remove(name)
	return combineErrors(closeErr, removeErr)
}

func uniqueCleanPaths(paths ...string) []string {
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, raw := range paths {
		pathValue := filepath.Clean(strings.TrimSpace(raw))
		if pathValue == "" {
			continue
		}
		key := strings.ToLower(pathValue)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, pathValue)
	}
	return out
}
