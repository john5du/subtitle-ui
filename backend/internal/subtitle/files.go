package subtitle

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var allowedExtensions = map[string]struct{}{
	".srt": {},
	".ass": {},
	".ssa": {},
	".vtt": {},
	".sub": {},
}

func IsValidExtension(ext string) bool {
	_, ok := allowedExtensions[strings.ToLower(ext)]
	return ok
}

func EnsureWithinRoot(root string, target string) bool {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

func BuildNewSubtitlePath(videoPath string, label string, ext string) (string, error) {
	target := BuildCanonicalSubtitlePath(videoPath, label, ext)
	if !exists(target) {
		return target, nil
	}

	videoDir := filepath.Dir(videoPath)
	videoName := filepath.Base(videoPath)
	videoBase := strings.TrimSuffix(videoName, filepath.Ext(videoName))
	safeLabel := normalizeLabel(label)
	for i := 1; i <= 9999; i++ {
		next := filepath.Join(videoDir, fmt.Sprintf("%s.%s-%d%s", videoBase, safeLabelOrDefault(safeLabel), i, ext))
		if !exists(next) {
			return next, nil
		}
	}

	return "", fmt.Errorf("unable to build unique subtitle filename for %s", videoPath)
}

func BuildCanonicalSubtitlePath(videoPath string, label string, ext string) string {
	videoDir := filepath.Dir(videoPath)
	videoName := filepath.Base(videoPath)
	videoBase := strings.TrimSuffix(videoName, filepath.Ext(videoName))

	normalizedExt := strings.ToLower(strings.TrimSpace(ext))
	if normalizedExt != "" && !strings.HasPrefix(normalizedExt, ".") {
		normalizedExt = "." + normalizedExt
	}

	safeLabel := normalizeLabel(label)
	candidate := videoBase + normalizedExt
	if safeLabel != "" {
		candidate = fmt.Sprintf("%s.%s%s", videoBase, safeLabel, normalizedExt)
	}

	return filepath.Join(videoDir, candidate)
}

func InferLabelFromSubtitlePath(videoPath string, subtitlePath string) string {
	videoName := filepath.Base(videoPath)
	videoBase := strings.TrimSuffix(videoName, filepath.Ext(videoName))
	subtitleName := filepath.Base(subtitlePath)
	subtitleBase := strings.TrimSuffix(subtitleName, filepath.Ext(subtitleName))

	if strings.EqualFold(subtitleBase, videoBase) {
		return ""
	}

	if len(subtitleBase) <= len(videoBase) {
		return ""
	}
	if !strings.EqualFold(subtitleBase[:len(videoBase)], videoBase) {
		return ""
	}

	separator := subtitleBase[len(videoBase)]
	if separator != '.' && separator != '_' && separator != '-' {
		return ""
	}

	rawLabel := strings.TrimSpace(subtitleBase[len(videoBase)+1:])
	return normalizeLabel(rawLabel)
}

func BackupFile(path string) (string, error) {
	source, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer source.Close()

	backupPath := path + ".bak." + time.Now().UTC().Format("20060102-150405")
	target, err := os.Create(backupPath)
	if err != nil {
		return "", err
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		return "", err
	}

	return backupPath, nil
}

func WriteUploadedFile(file multipart.File, target string) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".upload-*"+filepath.Ext(target))
	if err != nil {
		return err
	}
	tmpName := tmp.Name()

	if _, err := io.Copy(tmp, file); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}

	if err := os.Rename(tmpName, target); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}

func PathExists(path string) bool {
	return exists(path)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func normalizeLabel(label string) string {
	label = strings.ToLower(strings.TrimSpace(label))
	if label == "" {
		return ""
	}

	var b strings.Builder
	lastDash := false
	for _, ch := range label {
		isLetter := ch >= 'a' && ch <= 'z'
		isDigit := ch >= '0' && ch <= '9'
		if isLetter || isDigit {
			b.WriteRune(ch)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}

	normalized := strings.Trim(b.String(), "-")
	return normalized
}

func safeLabelOrDefault(label string) string {
	if label == "" {
		return "custom"
	}
	return label
}
