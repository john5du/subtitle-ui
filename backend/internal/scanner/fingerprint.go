package scanner

import (
	"path/filepath"
	"time"

	"subtitle-ui/backend/internal/domain"
)

const fingerprintVersion = "fp1"

// ComputeMediaFingerprint builds a stable disk fingerprint for video + NFO +
// sidecar subtitles (no content reads). posterPath may be empty.
func ComputeMediaFingerprint(videoPath string, mediaType string, posterPath string) (fp string, size int64, modTime time.Time, err error) {
	return NewDirIndex().ComputeMediaFingerprint(videoPath, mediaType, posterPath)
}

func nfoCandidatePaths(dir string, base string, mediaType string) []string {
	out := []string{
		filepath.Join(dir, base+".nfo"),
		filepath.Join(dir, "movie.nfo"),
	}
	if mediaType == domain.MediaTypeTV {
		currentDir := dir
		for i := 0; i < 3; i++ {
			out = append(out, filepath.Join(currentDir, "tvshow.nfo"))
			parent := filepath.Dir(currentDir)
			if parent == currentDir {
				break
			}
			currentDir = parent
		}
	}
	return out
}

type fingerprintEntry struct {
	path    string
	size    int64
	modNano int64
}
