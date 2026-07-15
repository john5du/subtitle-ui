package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func (s *Server) handleUI(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	info, err := os.Stat(s.uiDist)
	if err != nil || !info.IsDir() {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("frontend is not built yet. Run `bun install && bun run build` in frontend/"))
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	filePath := filepath.Join(s.uiDist, filepath.FromSlash(cleanPath))
	if !withinDir(s.uiDist, filePath) {
		writeError(w, http.StatusForbidden, "invalid path")
		return
	}
	if existsFile(filePath) {
		http.ServeFile(w, r, filePath)
		return
	}

	indexPath := filepath.Join(s.uiDist, "index.html")
	if existsFile(indexPath) {
		http.ServeFile(w, r, indexPath)
		return
	}

	http.NotFound(w, r)
}
