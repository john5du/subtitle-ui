package jellyfin

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
)

// Playback modes for browser preview.
const (
	PlaybackModeProgressive = "progressive"
	PlaybackModeHLS         = "hls"
)

const previewDeviceID = "subtitle-ui-preview"

// PlaybackPlan is how the browser should consume a Jellyfin item for preview.
type PlaybackPlan struct {
	Mode          string // progressive | hls
	PlaySessionID string
	MediaSourceID string
	// UpstreamPath is path+query on the Jellyfin base URL (no scheme/host), secrets stripped.
	UpstreamPath string
}

type playbackInfoResponse struct {
	PlaySessionID string             `json:"PlaySessionId"`
	MediaSources  []playbackMediaSrc `json:"MediaSources"`
}

type playbackMediaSrc struct {
	ID                   string `json:"Id"`
	TranscodingURL       string `json:"TranscodingUrl"`
	SupportsDirectPlay   bool   `json:"SupportsDirectPlay"`
	SupportsDirectStream bool   `json:"SupportsDirectStream"`
	SupportsTranscoding  bool   `json:"SupportsTranscoding"`
}

// ResolvePlaybackPlan asks Jellyfin how to stream an item for browser preview.
// DeviceProfile declares AAC-preferring audio so EAC3/DTS trigger audio transcoding.
func (c *Client) ResolvePlaybackPlan(ctx context.Context, itemID string) (PlaybackPlan, error) {
	if !c.Enabled() {
		return PlaybackPlan{}, ErrDisabled
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return PlaybackPlan{}, fmt.Errorf("item id required")
	}

	// DeviceProfile path calls SetDeviceSpecificData which requires a real UserId
	// (API-key auth has no user claim → empty Guid → "Guid can't be empty").
	userID, err := c.resolvePlaybackUserID(ctx)
	if err != nil {
		return PlaybackPlan{}, err
	}

	body := map[string]any{
		"UserId":               userID,
		"DeviceProfile":        previewDeviceProfile(),
		"EnableDirectPlay":     true,
		"EnableDirectStream":   true,
		"EnableTranscoding":    true,
		"AllowVideoStreamCopy": true,
		"AllowAudioStreamCopy": false,
		"MaxStreamingBitrate":  80_000_000,
		"MaxAudioChannels":     2,
		"AutoOpenLiveStream":   false,
	}

	var resp playbackInfoResponse
	q := url.Values{}
	q.Set("DeviceId", previewDeviceID)
	q.Set("UserId", userID)
	path := "/Items/" + url.PathEscape(itemID) + "/PlaybackInfo?" + q.Encode()
	if err := c.postJSON(ctx, path, body, &resp); err != nil {
		return PlaybackPlan{}, err
	}
	if len(resp.MediaSources) == 0 {
		return PlaybackPlan{}, fmt.Errorf("%w: no media sources", ErrItemNotFound)
	}
	src := resp.MediaSources[0]
	mediaSourceID := strings.TrimSpace(src.ID)
	playSessionID := strings.TrimSpace(resp.PlaySessionID)

	if up := NormalizeUpstreamPath(src.TranscodingURL); up != "" {
		return PlaybackPlan{
			Mode:          PlaybackModeHLS,
			PlaySessionID: playSessionID,
			MediaSourceID: mediaSourceID,
			UpstreamPath:  up,
		}, nil
	}

	qStream := url.Values{}
	qStream.Set("static", "true")
	if mediaSourceID != "" {
		qStream.Set("MediaSourceId", mediaSourceID)
	}
	if playSessionID != "" {
		qStream.Set("PlaySessionId", playSessionID)
	}
	up := "/Videos/" + url.PathEscape(itemID) + "/stream?" + qStream.Encode()
	return PlaybackPlan{
		Mode:          PlaybackModeProgressive,
		PlaySessionID: playSessionID,
		MediaSourceID: mediaSourceID,
		UpstreamPath:  up,
	}, nil
}

type jellyfinUserDTO struct {
	ID     string `json:"Id"`
	Name   string `json:"Name"`
	Policy struct {
		IsAdministrator bool `json:"IsAdministrator"`
		IsDisabled      bool `json:"IsDisabled"`
	} `json:"Policy"`
}

// resolvePlaybackUserID returns a Jellyfin user GUID for PlaybackInfo.
// Prefer configured UserID; otherwise list /Users and pick admin, then any enabled user.
func (c *Client) resolvePlaybackUserID(ctx context.Context) (string, error) {
	if id := strings.TrimSpace(c.userID); id != "" {
		return id, nil
	}
	c.userIDMu.Lock()
	defer c.userIDMu.Unlock()
	if c.cachedUserID != "" {
		return c.cachedUserID, nil
	}
	var users []jellyfinUserDTO
	if err := c.getJSON(ctx, "/Users", nil, &users); err != nil {
		return "", fmt.Errorf("jellyfin list users for playback: %w", err)
	}
	pick := ""
	for _, u := range users {
		id := strings.TrimSpace(u.ID)
		if id == "" || u.Policy.IsDisabled {
			continue
		}
		if u.Policy.IsAdministrator {
			pick = id
			break
		}
		if pick == "" {
			pick = id
		}
	}
	if pick == "" {
		return "", fmt.Errorf("jellyfin: no enabled user for PlaybackInfo (set JELLYFIN_USER_ID)")
	}
	c.cachedUserID = pick
	log.Printf("jellyfin playback user auto-selected id=%s", pick)
	return pick, nil
}

// OpenAuthenticatedPath GETs/HEADs path+query on the Jellyfin base URL with API auth.
func (c *Client) OpenAuthenticatedPath(ctx context.Context, method, pathAndQuery, rangeHeader string) (*StreamResponse, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	pathAndQuery = strings.TrimSpace(pathAndQuery)
	if err := ValidateUpstreamPath(pathAndQuery); err != nil {
		return nil, err
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = http.MethodGet
	}
	switch method {
	case http.MethodGet, http.MethodHead:
	default:
		return nil, fmt.Errorf("unsupported method %s", method)
	}

	full := c.baseURL + pathAndQuery
	req, err := http.NewRequestWithContext(ctx, method, full, nil)
	if err != nil {
		return nil, err
	}
	c.setAuth(req)
	if rangeHeader = strings.TrimSpace(rangeHeader); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := c.streamHTTPClient().Do(req)
	if err != nil {
		log.Printf("jellyfin stream network failed path=%s err=%v", pathAndQuery, err)
		return nil, err
	}
	if !isPassThroughStreamStatus(resp.StatusCode) {
		defer resp.Body.Close()
		sample, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		msg := jellyfinHTTPError(resp.StatusCode, truncate(string(sample), 200))
		log.Printf("jellyfin stream failed path=%s status=%s bodySample=%q", pathAndQuery, resp.Status, truncate(string(sample), 200))
		return nil, fmt.Errorf("jellyfin stream: %s", msg)
	}
	return &StreamResponse{
		StatusCode: resp.StatusCode,
		Header:     resp.Header.Clone(),
		Body:       resp.Body,
	}, nil
}

// ValidateUpstreamPath rejects SSRF-ish paths (must be root-relative on Jellyfin).
func ValidateUpstreamPath(pathAndQuery string) error {
	pathAndQuery = strings.TrimSpace(pathAndQuery)
	if pathAndQuery == "" {
		return fmt.Errorf("empty upstream path")
	}
	if !strings.HasPrefix(pathAndQuery, "/") || strings.HasPrefix(pathAndQuery, "//") {
		return fmt.Errorf("upstream path must be root-relative")
	}
	lower := strings.ToLower(pathAndQuery)
	if strings.Contains(lower, "://") || strings.Contains(pathAndQuery, "\\") {
		return fmt.Errorf("invalid upstream path")
	}
	u, err := url.Parse(pathAndQuery)
	if err != nil {
		return fmt.Errorf("invalid upstream path: %w", err)
	}
	if u.Host != "" || u.Scheme != "" {
		return fmt.Errorf("upstream path must not include host")
	}
	if u.Path == "" || u.Path == "/" {
		return fmt.Errorf("upstream path empty")
	}
	if strings.Contains(u.Path, "..") {
		return fmt.Errorf("invalid upstream path")
	}
	cleaned := path.Clean(u.Path)
	if cleaned == "/" || cleaned == "." || strings.Contains(cleaned, "..") {
		return fmt.Errorf("invalid upstream path")
	}
	return nil
}

// ValidateHLSSegmentPath ensures pathAndQuery is a media path for the ticket item only.
// Rejects system APIs and other items so a ticket cannot become an open JF GET proxy.
func ValidateHLSSegmentPath(pathAndQuery, itemID string) error {
	if err := ValidateUpstreamPath(pathAndQuery); err != nil {
		return err
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return fmt.Errorf("item id required")
	}
	u, err := url.Parse(pathAndQuery)
	if err != nil {
		return fmt.Errorf("invalid upstream path: %w", err)
	}
	cleaned := path.Clean(u.Path)
	segments := strings.Split(strings.Trim(cleaned, "/"), "/")
	if len(segments) < 2 {
		return fmt.Errorf("upstream path not media for item")
	}
	switch strings.ToLower(segments[0]) {
	case "videos", "audio":
	default:
		return fmt.Errorf("upstream path not media")
	}
	segItem, err := url.PathUnescape(segments[1])
	if err != nil {
		segItem = segments[1]
	}
	// Jellyfin may use GUID with or without hyphens in different endpoints.
	if !jellyfinItemIDsEqual(segItem, itemID) {
		return fmt.Errorf("upstream path item mismatch")
	}
	return nil
}

func jellyfinItemIDsEqual(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || b == "" {
		return false
	}
	if strings.EqualFold(a, b) {
		return true
	}
	na := strings.ReplaceAll(strings.ToLower(a), "-", "")
	nb := strings.ReplaceAll(strings.ToLower(b), "-", "")
	return na == nb
}

// IsM3U8Path reports whether pathAndQuery's URL path ends with .m3u8.
func IsM3U8Path(pathAndQuery string) bool {
	u, err := url.Parse(strings.TrimSpace(pathAndQuery))
	if err != nil {
		return false
	}
	p := u.Path
	if p == "" {
		// path-only strings without leading slash still parse into Path sometimes empty
		if i := strings.Index(pathAndQuery, "?"); i >= 0 {
			p = pathAndQuery[:i]
		} else {
			p = pathAndQuery
		}
	}
	return strings.HasSuffix(strings.ToLower(p), ".m3u8")
}

// NormalizeUpstreamPath turns a TranscodingUrl into path+query without secrets.
func NormalizeUpstreamPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	path := u.EscapedPath()
	if path == "" {
		path = u.Path
	}
	if path == "" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	q := u.Query()
	stripSecretQuery(q)
	enc := q.Encode()
	if enc != "" {
		return path + "?" + enc
	}
	return path
}

func stripSecretQuery(q url.Values) {
	for k := range q {
		lk := strings.ToLower(k)
		if lk == "api_key" || lk == "apikey" || strings.Contains(lk, "token") {
			q.Del(k)
		}
	}
}

func previewDeviceProfile() map[string]any {
	// Matches Jellyfin DeviceProfile (MediaBrowser.Model.Dlna): Id is Guid? — never send a free-form string.
	directPlayProfiles := []map[string]any{
		{"Type": "Video", "Container": "mp4,m4v", "VideoCodec": "h264,hevc,av1", "AudioCodec": "aac,mp3,opus"},
		{"Type": "Video", "Container": "webm", "VideoCodec": "vp8,vp9,av1", "AudioCodec": "opus,vorbis"},
	}
	transcodingProfiles := []map[string]any{
		{
			"Type":                      "Video",
			"Container":                 "ts",
			"Protocol":                  "hls",
			"VideoCodec":                "h264,hevc",
			"AudioCodec":                "aac",
			"Context":                   "Streaming",
			"MaxAudioChannels":          "2",
			"MinSegments":               1,
			"SegmentLength":             6,
			"CopyTimestamps":            true,
			"EnableSubtitlesInManifest": false,
		},
	}
	return map[string]any{
		"Name":                             "subtitle-ui preview",
		"MaxStreamingBitrate":              80_000_000,
		"MaxStaticBitrate":                 80_000_000,
		"MusicStreamingTranscodingBitrate": 384000,
		"DirectPlayProfiles":               directPlayProfiles,
		"TranscodingProfiles":              transcodingProfiles,
		"CodecProfiles": []map[string]any{
			{
				"Type":  "VideoAudio",
				"Codec": "aac",
				"Conditions": []map[string]any{
					{"Condition": "EqualsAny", "Property": "AudioChannels", "Value": "1|2", "IsRequired": false},
				},
			},
		},
		"SubtitleProfiles": []map[string]any{
			{"Format": "vtt", "Method": "External"},
			{"Format": "srt", "Method": "External"},
		},
	}
}
