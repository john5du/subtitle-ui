package scanner

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
)

type nfoMetadata struct {
	Title         string `xml:"title"`
	OriginalTitle string `xml:"originaltitle"`
	Year          string `xml:"year"`
	ImdbID        string `xml:"imdb_id"`
	TmdbID        string `xml:"tmdbid"`
}

func readVideoMetadata(dir string, base string) (nfoMetadata, string) {
	directCandidates := []string{
		filepath.Join(dir, base+".nfo"),
		filepath.Join(dir, "movie.nfo"),
	}
	for _, path := range directCandidates {
		if metadata, ok := parseNFO(path); ok {
			return metadata, "nfo"
		}
	}
	return nfoMetadata{}, ""
}

func readTVSeriesMetadata(dir string) (nfoMetadata, string) {
	currentDir := dir
	for i := 0; i < 3; i++ {
		if metadata, ok := parseNFO(filepath.Join(currentDir, "tvshow.nfo")); ok {
			return metadata, "nfo"
		}
		parent := filepath.Dir(currentDir)
		if parent == currentDir {
			break
		}
		currentDir = parent
	}
	return nfoMetadata{}, ""
}

func parseNFO(path string) (nfoMetadata, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nfoMetadata{}, false
	}
	var parsed nfoMetadata
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return nfoMetadata{}, false
	}
	parsed.Title = strings.TrimSpace(parsed.Title)
	parsed.OriginalTitle = strings.TrimSpace(parsed.OriginalTitle)
	parsed.Year = strings.TrimSpace(parsed.Year)
	parsed.ImdbID = strings.TrimSpace(parsed.ImdbID)
	parsed.TmdbID = strings.TrimSpace(parsed.TmdbID)
	if parsed.Title == "" {
		parsed.Title = parsed.OriginalTitle
	}
	if parsed.Title == "" && parsed.OriginalTitle == "" && parsed.Year == "" && parsed.ImdbID == "" && parsed.TmdbID == "" {
		return nfoMetadata{}, false
	}
	return parsed, true
}

