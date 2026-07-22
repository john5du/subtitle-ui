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
	SubtitleSourceDownload  = "download"
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
	FileSize            int64      `json:"-"`
	FileModTime         time.Time  `json:"-"`
	ScanFingerprint     string     `json:"-"`
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

type SubHDConfig struct {
	Enabled        bool      `json:"enabled"`
	BaseURL        string    `json:"baseUrl"`
	Proxy          string    `json:"proxy"`
	DefaultBaseURL string    `json:"defaultBaseUrl"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type SubHDConfigUpdate struct {
	Enabled bool   `json:"enabled"`
	BaseURL string `json:"baseUrl"`
	Proxy   string `json:"proxy"`
}

type SonarrConfig struct {
	Enabled   bool      `json:"enabled"`
	URL       string    `json:"url"`
	APIKey    string    `json:"apiKey"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SonarrConfigUpdate struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	APIKey  string `json:"apiKey"`
}

// JellyfinConfig is effective Jellyfin notify settings (DB overrides env).
type JellyfinConfig struct {
	Enabled   bool      `json:"enabled"`
	URL       string    `json:"url"`
	APIKey    string    `json:"apiKey"`
	PathMap   string    `json:"pathMap"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// JellyfinConfigUpdate is the PUT body for Jellyfin settings.
type JellyfinConfigUpdate struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	APIKey  string `json:"apiKey"`
	PathMap string `json:"pathMap"`
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

// MissingEpisode is one expected episode not present in the local library.
type MissingEpisode struct {
	Episode         int    `json:"episode"`
	SonarrEpisodeID int    `json:"sonarrEpisodeId"`
	Title           string `json:"title,omitempty"`
	AirDate         string `json:"airDate,omitempty"`
}

// SeasonCompleteness compares local TV files against Sonarr expected episodes.
type SeasonCompleteness struct {
	Enabled        bool             `json:"enabled"`
	Matched        bool             `json:"matched"`
	Complete       bool             `json:"complete"`
	Source         string           `json:"source,omitempty"`
	Season         int              `json:"season"`
	ExpectedCount  int              `json:"expectedCount"`
	LocalCount     int              `json:"localCount"`
	Missing        []MissingEpisode `json:"missing"`
	SonarrSeriesID int              `json:"sonarrSeriesId,omitempty"`
	SeriesStatus   string           `json:"seriesStatus,omitempty"`
	Message        string           `json:"message,omitempty"`
}

// SonarrSearchRequest triggers Sonarr EpisodeSearch for missing episodes.
type SonarrSearchRequest struct {
	Path       string `json:"path"`
	Key        string `json:"key"`
	Season     int    `json:"season"`
	Episodes   []int  `json:"episodes"`
	AllMissing bool   `json:"allMissing"`
}

// SonarrSearchResult is the outcome of queueing a Sonarr search command.
type SonarrSearchResult struct {
	Queued     bool   `json:"queued"`
	CommandID  int    `json:"commandId,omitempty"`
	EpisodeIDs []int  `json:"episodeIds,omitempty"`
	Message    string `json:"message,omitempty"`
}

type VersionInfo struct {
	Version      string `json:"version"`
	DatabaseType string `json:"databaseType"`
}

const (
	SubtitleNormalizeRename        = "rename"
	SubtitleNormalizeNoop          = "noop"
	SubtitleNormalizeSkipConflict  = "skip_conflict"
	SubtitleNormalizeApplyOK       = "ok"
	SubtitleNormalizeApplySkipped  = "skipped"
	SubtitleNormalizeApplyFailed   = "failed"
)

// SubtitleNormalizeItem is one planned rename for Jellyfin-style filenames.
type SubtitleNormalizeItem struct {
	VideoID      string `json:"videoId"`
	SubtitleID   string `json:"subtitleId"`
	FromPath     string `json:"fromPath"`
	FromFileName string `json:"fromFileName"`
	ToPath       string `json:"toPath"`
	ToFileName   string `json:"toFileName"`
	FromLanguage string `json:"fromLanguage"`
	ToLabel      string `json:"toLabel"`
	Status       string `json:"status"`
	Reason       string `json:"reason,omitempty"`
}

// SubtitleNormalizePlan is the preview response for batch rename.
type SubtitleNormalizePlan struct {
	Items []SubtitleNormalizeItem `json:"items"`
}

// SubtitleNormalizeApplyItem selects one planned rename to apply.
type SubtitleNormalizeApplyItem struct {
	VideoID    string `json:"videoId"`
	SubtitleID string `json:"subtitleId"`
	ToPath     string `json:"toPath"`
}

// SubtitleNormalizeApplyItemResult is the per-item apply outcome.
type SubtitleNormalizeApplyItemResult struct {
	VideoID      string `json:"videoId"`
	SubtitleID   string `json:"subtitleId"`
	FromPath     string `json:"fromPath,omitempty"`
	ToPath       string `json:"toPath,omitempty"`
	FromFileName string `json:"fromFileName,omitempty"`
	ToFileName   string `json:"toFileName,omitempty"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
	BackupPath   string `json:"backupPath,omitempty"`
}

// SubtitleNormalizeApplyResult summarizes a batch apply.
type SubtitleNormalizeApplyResult struct {
	Results []SubtitleNormalizeApplyItemResult `json:"results"`
	Renamed int                                `json:"renamed"`
	Skipped int                                `json:"skipped"`
	Failed  int                                `json:"failed"`
}

// TVSeasonNormalizeRequest scopes a season-level normalize plan/apply.
type TVSeasonNormalizeRequest struct {
	Path   string                       `json:"path"`
	Key    string                       `json:"key"`
	Season int                          `json:"season"`
	Items  []SubtitleNormalizeApplyItem `json:"items,omitempty"`
}
