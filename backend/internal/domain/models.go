package domain

import "time"

const (
	MediaTypeMovie = "movie"
	MediaTypeTV    = "tv"
)

const (
	SubtitleSourceDirectory = "directory"
	SubtitleSourceUpload    = "upload"
	SubtitleSourceGenerated = "generated"
)

type Video struct {
	ID                  string     `json:"id"`
	Path                string     `json:"path"`
	Directory           string     `json:"directory"`
	FileName            string     `json:"fileName"`
	Title               string     `json:"title"`
	OriginalTitle       string     `json:"originalTitle,omitempty"`
	Year                string     `json:"year,omitempty"`
	ImdbID              string     `json:"imdbId,omitempty"`
	TmdbID              string     `json:"tmdbId,omitempty"`
	MediaType           string     `json:"mediaType"`
	MetadataSource      string     `json:"metadataSource"`
	SeriesTitle         string     `json:"seriesTitle,omitempty"`
	SeriesOriginalTitle string     `json:"seriesOriginalTitle,omitempty"`
	SeriesImdbID        string     `json:"seriesImdbId,omitempty"`
	SeriesTmdbID        string     `json:"seriesTmdbId,omitempty"`
	PosterPath          string     `json:"-"`
	PosterURL           string     `json:"posterUrl,omitempty"`
	Subtitles           []Subtitle `json:"subtitles"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

type Subtitle struct {
	ID           string    `json:"id"`
	Path         string    `json:"path"`
	FileName     string    `json:"fileName"`
	Language     string    `json:"language"`
	Format       string    `json:"format"`
	Size         int64     `json:"size"`
	ModTime      time.Time `json:"modTime"`
	Source       string    `json:"source"`
	SourceDetail string    `json:"sourceDetail,omitempty"`
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

type OperationLogPage struct {
	Items      []OperationLog `json:"items"`
	Total      int            `json:"total"`
	Page       int            `json:"page"`
	PageSize   int            `json:"pageSize"`
	TotalPages int            `json:"totalPages"`
}

type AppSetting struct {
	Key       string
	Value     string
	UpdatedAt time.Time
}

type SubtitleConversionConfig struct {
	ASSTemplate           string    `json:"assTemplate"`
	DefaultASSTemplate    string    `json:"defaultAssTemplate"`
	SourceEncodingDefault string    `json:"sourceEncodingDefault"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type SubtitleConversionConfigUpdate struct {
	ASSTemplate           string `json:"assTemplate"`
	SourceEncodingDefault string `json:"sourceEncodingDefault"`
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
	OriginalTitle     string `json:"originalTitle,omitempty"`
	ImdbID            string `json:"imdbId,omitempty"`
	TmdbID            string `json:"tmdbId,omitempty"`
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
