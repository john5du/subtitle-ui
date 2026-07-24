package jellyfin

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// PathMap rewrites local media paths to paths Jellyfin sees.
type PathMap struct {
	From string
	To   string
}

// ParsePathMaps parses "from:to,from2:to2" into path maps.
// From/to may be absolute paths; longer From prefixes win when mapping.
func ParsePathMaps(raw string) ([]PathMap, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]PathMap, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		from, to, ok := splitPathMapPair(part)
		if !ok {
			return nil, fmt.Errorf("invalid path map entry %q (want from:to)", part)
		}
		from = normalizeMapPath(from)
		to = normalizeMapPath(to)
		if from == "" || to == "" {
			return nil, fmt.Errorf("invalid path map entry %q (empty from/to)", part)
		}
		out = append(out, PathMap{From: from, To: to})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return len(out[i].From) > len(out[j].From)
	})
	return out, nil
}

// FormatPathMaps serializes path maps back to the env/DB string form.
func FormatPathMaps(maps []PathMap) string {
	if len(maps) == 0 {
		return ""
	}
	parts := make([]string, 0, len(maps))
	for _, m := range maps {
		from := strings.TrimSpace(m.From)
		to := strings.TrimSpace(m.To)
		if from == "" || to == "" {
			continue
		}
		parts = append(parts, from+":"+to)
	}
	return strings.Join(parts, ",")
}

// PhysicalPaths returns library physical roots from GET /Library/PhysicalPaths.
func (c *Client) PhysicalPaths(ctx context.Context) ([]string, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	var paths []string
	if err := c.getJSON(ctx, "/Library/PhysicalPaths", nil, &paths); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// ValidatePathMaps checks configured map targets against Jellyfin library roots.
// When no path maps are set, returns nil. When maps are set but none match, returns an error.
func (c *Client) ValidatePathMaps(ctx context.Context) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	if len(c.pathMaps) == 0 {
		return nil
	}
	physical, err := c.PhysicalPaths(ctx)
	if err != nil {
		return fmt.Errorf("list library paths: %w", err)
	}
	if len(physical) == 0 {
		return fmt.Errorf("jellyfin returned no library physical paths")
	}
	unmatched := make([]string, 0)
	for _, m := range c.pathMaps {
		if !pathMapTargetMatchesLibrary(m.To, physical) {
			unmatched = append(unmatched, m.From+":"+m.To)
		}
	}
	if len(unmatched) == 0 {
		return nil
	}
	known := make([]string, 0, len(physical))
	for _, p := range physical {
		known = append(known, normalizeMapPath(p))
	}
	return fmt.Errorf("path map target(s) not under any Jellyfin library root: %s (library roots: %s)",
		strings.Join(unmatched, ", "),
		strings.Join(known, ", "))
}

// pathMapTargetMatchesLibrary reports whether mapTo equals, contains, or is contained by a library root.
func pathMapTargetMatchesLibrary(mapTo string, physical []string) bool {
	to := normalizeMapPath(mapTo)
	if to == "" {
		return false
	}
	for _, p := range physical {
		root := normalizeMapPath(p)
		if root == "" {
			continue
		}
		if to == root || pathHasPrefix(to, root) || pathHasPrefix(root, to) {
			return true
		}
	}
	return false
}

// PathMaps returns a copy of configured path maps.
func (c *Client) PathMaps() []PathMap {
	if c == nil || len(c.pathMaps) == 0 {
		return nil
	}
	out := make([]PathMap, len(c.pathMaps))
	copy(out, c.pathMaps)
	return out
}

// MapPath rewrites a local path using configured path maps.
func (c *Client) MapPath(localPath string) string {
	if c == nil {
		return localPath
	}
	return MapPath(localPath, c.pathMaps)
}

// MapPath rewrites localPath using maps (longest From prefix wins).
func MapPath(localPath string, maps []PathMap) string {
	localPath = strings.TrimSpace(localPath)
	if localPath == "" || len(maps) == 0 {
		return localPath
	}
	normalized := normalizeMapPath(localPath)
	for _, m := range maps {
		if pathHasPrefix(normalized, m.From) {
			rest := strings.TrimPrefix(normalized, m.From)
			rest = strings.TrimPrefix(rest, "/")
			if rest == "" {
				return m.To
			}
			return joinMapped(m.To, rest)
		}
	}
	return localPath
}

func splitPathMapPair(part string) (from, to string, ok bool) {
	// Prefer last colon that still leaves a non-empty "to" (Windows drive letters: C:/a:D:/b).
	// Strategy: split on ":" but if from looks like Windows drive (X) and more remains, keep going.
	idx := strings.Index(part, ":")
	if idx <= 0 {
		return "", "", false
	}
	// Handle "C:/movies:/data/movies" style: first segment is a Windows drive letter.
	if len(part) > 2 && part[1] == ':' && (part[2] == '/' || part[2] == '\\') {
		j := strings.Index(part[2:], ":")
		if j < 0 {
			return "", "", false
		}
		j += 2
		from = part[:j]
		to = part[j+1:]
		if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
			return "", "", false
		}
		return from, to, true
	}
	// General: split on first ":" (POSIX paths don't contain colon).
	from = part[:idx]
	to = part[idx+1:]
	if strings.TrimSpace(from) == "" || strings.TrimSpace(to) == "" {
		return "", "", false
	}
	// If "to" also starts with Windows drive, keep as-is (first colon split is wrong only when from has drive).
	return from, to, true
}

func normalizeMapPath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, "\\", "/")
	for strings.Contains(p, "//") {
		// Keep leading // for UNC? treat as single-host media paths.
		if strings.HasPrefix(p, "//") {
			rest := strings.TrimLeft(p[2:], "/")
			p = "//" + rest
			// collapse remaining
			for strings.Contains(p[2:], "//") {
				p = p[:2] + strings.ReplaceAll(p[2:], "//", "/")
			}
			break
		}
		p = strings.ReplaceAll(p, "//", "/")
	}
	if len(p) > 1 && strings.HasSuffix(p, "/") {
		p = strings.TrimRight(p, "/")
	}
	return p
}

func pathHasPrefix(path, prefix string) bool {
	if path == prefix {
		return true
	}
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	if len(path) == len(prefix) {
		return true
	}
	// boundary: next rune must be /
	return path[len(prefix)] == '/'
}

func joinMapped(root, rest string) string {
	root = strings.TrimRight(root, "/")
	rest = strings.TrimLeft(rest, "/")
	if root == "" {
		return rest
	}
	if rest == "" {
		return root
	}
	return root + "/" + rest
}

func normalizeComparePath(p string) string {
	p = normalizeMapPath(p)
	return strings.ToLower(p)
}
