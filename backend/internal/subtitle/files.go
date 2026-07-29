package subtitle

import (
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
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
	if resolved, err := filepath.EvalSymlinks(rootAbs); err == nil {
		rootAbs = resolved
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	targetAbs = resolvePathForContainment(targetAbs)
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

// resolvePathForContainment EvalSymlinks the longest existing prefix, then
// re-appends any non-existent suffix (for not-yet-created write targets).
func resolvePathForContainment(targetAbs string) string {
	existing := targetAbs
	for {
		if resolved, err := filepath.EvalSymlinks(existing); err == nil {
			if existing == targetAbs {
				return resolved
			}
			suffix, err := filepath.Rel(existing, targetAbs)
			if err != nil || suffix == "." {
				return resolved
			}
			return filepath.Join(resolved, suffix)
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return targetAbs
		}
		existing = parent
	}
}

// IsSymlink reports whether path is a symbolic link (does not follow).
func IsSymlink(path string) bool {
	info, err := os.Lstat(path)
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeSymlink != 0
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

	normalizedExt := normalizeSubtitleExtension(ext)

	safeLabel := normalizeLabel(label)
	candidate := videoBase + normalizedExt
	if safeLabel != "" {
		candidate = fmt.Sprintf("%s.%s%s", videoBase, safeLabel, normalizedExt)
	}

	return filepath.Join(videoDir, candidate)
}

func BuildReplacementSubtitlePath(existingPath string, newExt string) string {
	dir := filepath.Dir(existingPath)
	name := filepath.Base(existingPath)
	base := strings.TrimSuffix(name, filepath.Ext(name))
	normalizedExt := normalizeSubtitleExtension(newExt)
	return filepath.Join(dir, base+normalizedExt)
}

func BuildUniqueSiblingSubtitlePath(sourcePath string, newExt string) (string, error) {
	dir := filepath.Dir(sourcePath)
	name := filepath.Base(sourcePath)
	base := strings.TrimSuffix(name, filepath.Ext(name))
	normalizedExt := normalizeSubtitleExtension(newExt)
	target := filepath.Join(dir, base+normalizedExt)
	if !exists(target) {
		return target, nil
	}

	for i := 1; i <= 9999; i++ {
		next := filepath.Join(dir, fmt.Sprintf("%s-%d%s", base, i, normalizedExt))
		if !exists(next) {
			return next, nil
		}
	}

	return "", fmt.Errorf("unable to build unique subtitle filename for %s", sourcePath)
}

func normalizeSubtitleExtension(ext string) string {
	normalized := strings.ToLower(strings.TrimSpace(ext))
	if normalized != "" && !strings.HasPrefix(normalized, ".") {
		normalized = "." + normalized
	}
	return normalized
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

	// Nanosecond + random suffix avoids same-second collisions overwriting backups.
	suffix := time.Now().UTC().Format("20060102-150405.000000000")
	var nonce [4]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err == nil {
		suffix += "-" + fmt.Sprintf("%x", nonce)
	}
	backupPath := path + ".bak." + suffix
	target, err := os.OpenFile(backupPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", err
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		_ = os.Remove(backupPath)
		return "", err
	}

	return backupPath, nil
}

// backupPathPattern matches BackupFile suffixes: .bak.YYYYMMDD-HHMMSS...
var backupPathPattern = regexp.MustCompile(`\.bak\.\d{8}-\d{6}`)

// IsBackupPath reports whether path looks like a BackupFile sidecar (not arbitrary ".bak." names).
func IsBackupPath(path string) bool {
	return backupPathPattern.MatchString(filepath.Base(path))
}

// SourcePathFromBackup returns the original path for a BackupFile sidecar, or empty if not a backup.
func SourcePathFromBackup(backupPath string) string {
	base := filepath.Base(backupPath)
	loc := backupPathPattern.FindStringIndex(base)
	if loc == nil {
		return ""
	}
	// base is "file.srt.bak.TIMESTAMP..." → source base before ".bak."
	srcBase := base[:loc[0]]
	if srcBase == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(backupPath), srcBase)
}

// RestoreFile copies backupPath onto targetPath (atomic via temp+rename when possible).
func RestoreFile(backupPath string, targetPath string) error {
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return err
	}
	return WriteFileBytes(data, targetPath)
}

func WriteFileBytes(data []byte, target string) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".subtitle-*"+filepath.Ext(target))
	if err != nil {
		return err
	}
	tmpName := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
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
	// Normalize common bilingual connectors to '&' (kept on disk for scanner).
	label = strings.NewReplacer("+", "&", ",", "&", "，", "&", "＆", "&", "/", "&", "|", "&").Replace(label)

	var b strings.Builder
	lastDash := false
	lastAmp := false
	for _, ch := range label {
		isLetter := ch >= 'a' && ch <= 'z'
		isDigit := ch >= '0' && ch <= '9'
		if isLetter || isDigit {
			b.WriteRune(ch)
			lastDash = false
			lastAmp = false
			continue
		}
		if ch == '&' {
			if b.Len() == 0 || lastAmp {
				continue
			}
			// Drop a trailing dash before ampersand (zh-&en → zh&en).
			s := b.String()
			if strings.HasSuffix(s, "-") {
				b.Reset()
				b.WriteString(strings.TrimRight(s, "-"))
			}
			if b.Len() == 0 {
				continue
			}
			b.WriteByte('&')
			lastAmp = true
			lastDash = false
			continue
		}
		if !lastDash && !lastAmp && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}

	return strings.Trim(b.String(), "-&")
}

func safeLabelOrDefault(label string) string {
	if label == "" {
		return "custom"
	}
	return label
}
