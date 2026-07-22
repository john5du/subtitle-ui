package jellyfin

import (
	"net/url"
	"path"
	"strings"
)

// RewriteM3U8 rewrites playlist URI lines and URI="..." attributes to go through rewrite().
// rewrite receives a root-relative Jellyfin path+query (secrets already stripped) and returns the proxy URL.
func RewriteM3U8(playlist string, basePath string, rewrite func(upstreamPath string) string) string {
	basePath = strings.TrimSpace(basePath)
	// base directory for relative segment URLs
	baseDir := basePath
	if i := strings.Index(baseDir, "?"); i >= 0 {
		baseDir = baseDir[:i]
	}
	if i := strings.LastIndex(baseDir, "/"); i >= 0 {
		baseDir = baseDir[: i+1]
	} else {
		baseDir = "/"
	}

	lines := strings.Split(playlist, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			out = append(out, line)
			continue
		}
		if strings.HasPrefix(trimmed, "#") {
			out = append(out, rewriteM3U8TagLine(line, baseDir, rewrite))
			continue
		}
		up := resolvePlaylistURI(trimmed, baseDir)
		if up == "" {
			out = append(out, line)
			continue
		}
		out = append(out, rewrite(up))
	}
	return strings.Join(out, "\n")
}

func rewriteM3U8TagLine(line, baseDir string, rewrite func(string) string) string {
	// Handle URI="..." in EXT-X-MAP, EXT-X-KEY, EXT-X-MEDIA, etc.
	const key = "URI=\""
	lower := line
	idx := strings.Index(strings.ToUpper(lower), "URI=\"")
	if idx < 0 {
		// also try uri=
		idx = strings.Index(lower, key)
		if idx < 0 {
			idx = strings.Index(strings.ToLower(lower), "uri=\"")
		}
	}
	if idx < 0 {
		return line
	}
	// find the URI=" starting at case-insensitive match
	startQuote := strings.Index(line[idx:], "\"")
	if startQuote < 0 {
		return line
	}
	start := idx + startQuote + 1
	end := strings.Index(line[start:], "\"")
	if end < 0 {
		return line
	}
	end += start
	rawURI := line[start:end]
	up := resolvePlaylistURI(rawURI, baseDir)
	if up == "" {
		return line
	}
	return line[:start] + rewrite(up) + line[end:]
}

func resolvePlaylistURI(raw, baseDir string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// Drop secrets if present
	if strings.Contains(raw, "://") {
		u, err := url.Parse(raw)
		if err != nil {
			return ""
		}
		return NormalizeUpstreamPath(u.RequestURI())
	}
	if strings.HasPrefix(raw, "/") {
		return cleanUpstreamPathAndQuery(raw)
	}
	// relative to playlist directory
	return cleanUpstreamPathAndQuery(baseDir + raw)
}

// cleanUpstreamPathAndQuery collapses . and .. in the path (query preserved).
func cleanUpstreamPathAndQuery(pathAndQuery string) string {
	pathAndQuery = strings.TrimSpace(pathAndQuery)
	if pathAndQuery == "" {
		return ""
	}
	pathPart := pathAndQuery
	query := ""
	if i := strings.Index(pathAndQuery, "?"); i >= 0 {
		pathPart = pathAndQuery[:i]
		query = pathAndQuery[i:]
	}
	cleaned := path.Clean(pathPart)
	if cleaned == "." {
		cleaned = "/"
	}
	if !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}
	if strings.Contains(cleaned, "..") {
		return ""
	}
	return NormalizeUpstreamPath(cleaned + query)
}
