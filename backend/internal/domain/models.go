package domain

import "time"

const (
	MediaTypeMovie = "movie"
	MediaTypeTV    = "tv"
)

type Video struct {
	ID             string     `json:"id"`
	Path           string     `json:"path"`
	Directory      string     `json:"directory"`
	FileName       string     `json:"fileName"`
	Title          string     `json:"title"`
	Year           string     `json:"year,omitempty"`
	MediaType      string     `json:"mediaType"`
	MetadataSource string     `json:"metadataSource"`
	PosterPath     string     `json:"-"`
	PosterURL      string     `json:"posterUrl,omitempty"`
	Subtitles      []Subtitle `json:"subtitles"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type Subtitle struct {
	ID       string    `json:"id"`
	Path     string    `json:"path"`
	FileName string    `json:"fileName"`
	Language string    `json:"language"`
	Format   string    `json:"format"`
	Size     int64     `json:"size"`
	ModTime  time.Time `json:"modTime"`
}

type ScanStatus struct {
	Running        bool       `json:"running"`
	LastStartedAt  *time.Time `json:"lastStartedAt,omitempty"`
	LastFinishedAt *time.Time `json:"lastFinishedAt,omitempty"`
	VideoCount     int        `json:"videoCount"`
	Error          string     `json:"error,omitempty"`
}

type OperationLog struct {
	ID         string    `json:"id"`
	Timestamp  time.Time `json:"timestamp"`
	Action     string    `json:"action"`
	VideoID    string    `json:"videoId"`
	TargetPath string    `json:"targetPath,omitempty"`
	BackupPath string    `json:"backupPath,omitempty"`
	Status     string    `json:"status"`
	Message    string    `json:"message,omitempty"`
}

type ScanDirectory struct {
	ID                string `json:"id"`
	Path              string `json:"path"`
	MediaType         string `json:"mediaType"`
	VideoFileCount    int    `json:"videoFileCount"`
	MetadataFileCount int    `json:"metadataFileCount"`
	HasVideo          bool   `json:"hasVideo"`
	HasMetadata       bool   `json:"hasMetadata"`
}

type DirectoryScanResult struct {
	GeneratedAt   time.Time       `json:"generatedAt"`
	MovieRoot     string          `json:"movieRoot,omitempty"`
	TVRoot        string          `json:"tvRoot,omitempty"`
	MovieCount    int             `json:"movieCount"`
	TVSeriesCount int             `json:"tvSeriesCount"`
	Movie         []ScanDirectory `json:"movie"`
	TV            []ScanDirectory `json:"tv"`
	Errors        []string        `json:"errors,omitempty"`
}

type VideoPage struct {
	Items      []Video `json:"items"`
	Total      int     `json:"total"`
	Page       int     `json:"page"`
	PageSize   int     `json:"pageSize"`
	TotalPages int     `json:"totalPages"`
}

type TVSeriesSummary struct {
	Key               string `json:"key"`
	Path              string `json:"path"`
	Title             string `json:"title"`
	LatestEpisodeYear string `json:"latestEpisodeYear,omitempty"`
	UpdatedAt         string `json:"updatedAt"`
	VideoCount        int    `json:"videoCount"`
	NoSubtitleCount   int    `json:"noSubtitleCount"`
	PosterVideoID     string `json:"-"`
	PosterURL         string `json:"posterUrl,omitempty"`
}

type TVSeriesPage struct {
	Items      []TVSeriesSummary `json:"items"`
	Total      int               `json:"total"`
	Page       int               `json:"page"`
	PageSize   int               `json:"pageSize"`
	TotalPages int               `json:"totalPages"`
}

type VersionInfo struct {
	Version string `json:"version"`
}
