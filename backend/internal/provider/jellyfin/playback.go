package jellyfin

import (
	"context"
	"errors"
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

// ErrPreviewUnplayable means metadata indicates the browser preview path is not supported
// (e.g. HDR sources that require Jellyfin tonemap). No media bytes are fetched to decide this.
var ErrPreviewUnplayable = errors.New("preview unplayable")

// PlaybackPlan is how the browser should consume a Jellyfin item for preview.
type PlaybackPlan struct {
	Mode          string // progressive | hls
	PlaySessionID string
	MediaSourceID string
	// UpstreamPath is path+query on the Jellyfin base URL (no scheme/host), secrets stripped.
	UpstreamPath string
	// MediaStreams from PlaybackInfo (used for browser-preview capability checks).
	MediaStreams []PlaybackMediaStream
}

// PlaybackMediaStream is a subset of Jellyfin MediaStream for preview decisions.
type PlaybackMediaStream struct {
	Type           string `json:"Type"`
	Codec          string `json:"Codec"`
	VideoRange     string `json:"VideoRange"`
	VideoRangeType string `json:"VideoRangeType"`
	ColorTransfer  string `json:"ColorTransfer"`
	Width          int    `json:"Width"`
	Height         int    `json:"Height"`
	IsExternal     bool   `json:"IsExternal"`
	IsTextSubtitle bool   `json:"IsTextSubtitleStream"`
}

type playbackInfoResponse struct {
	PlaySessionID string             `json:"PlaySessionId"`
	MediaSources  []playbackMediaSrc `json:"MediaSources"`
}

type playbackMediaSrc struct {
	ID                   string                `json:"Id"`
	TranscodingURL       string                `json:"TranscodingUrl"`
	SupportsDirectPlay   bool                  `json:"SupportsDirectPlay"`
	SupportsDirectStream bool                  `json:"SupportsDirectStream"`
	SupportsTranscoding  bool                  `json:"SupportsTranscoding"`
	MediaStreams         []PlaybackMediaStream `json:"MediaStreams"`
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

	// Jellyfin only applies Audio/SubtitleStreamIndex when MediaSourceId matches a source.
	// Probe without DeviceProfile first to learn MediaSourceId (+ streams for capability checks).
	mediaSourceID, probeStreams, err := c.probeMediaSource(ctx, itemID, userID)
	if err != nil {
		return PlaybackPlan{}, err
	}

	// SubtitleStreamIndex=-1: browser overlays our sidecar; never burn-in ASS (ffmpeg 187 with VAAPI).
	body := map[string]any{
		"UserId":                              userID,
		"DeviceProfile":                       previewDeviceProfile(),
		"EnableDirectPlay":                    true,
		"EnableDirectStream":                  true,
		"EnableTranscoding":                   true,
		"AllowVideoStreamCopy":                true,
		"AllowAudioStreamCopy":                false,
		"MaxStreamingBitrate":                 80_000_000,
		"MaxAudioChannels":                    2,
		"MediaSourceId":                       mediaSourceID,
		"SubtitleStreamIndex":                 -1,
		"AutoOpenLiveStream":                  false,
		"AlwaysBurnInSubtitleWhenTranscoding": false,
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
	if id := strings.TrimSpace(src.ID); id != "" {
		mediaSourceID = id
	}
	playSessionID := strings.TrimSpace(resp.PlaySessionID)

	streams := append([]PlaybackMediaStream(nil), src.MediaStreams...)
	if len(streams) == 0 {
		streams = append([]PlaybackMediaStream(nil), probeStreams...)
	}
	if up := NormalizeUpstreamPath(src.TranscodingURL); up != "" {
		plan := PlaybackPlan{
			Mode:          PlaybackModeHLS,
			PlaySessionID: playSessionID,
			MediaSourceID: mediaSourceID,
			UpstreamPath:  up,
			MediaStreams:  streams,
		}
		if err := AssessBrowserPreview(plan); err != nil {
			return PlaybackPlan{}, err
		}
		return plan, nil
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
	plan := PlaybackPlan{
		Mode:          PlaybackModeProgressive,
		PlaySessionID: playSessionID,
		MediaSourceID: mediaSourceID,
		UpstreamPath:  up,
		MediaStreams:  streams,
	}
	if err := AssessBrowserPreview(plan); err != nil {
		return PlaybackPlan{}, err
	}
	return plan, nil
}

// AssessBrowserPreview uses Jellyfin MediaStreams (+ planned mode) only — no byte-range/HLS fetch.
// Blocks paths that reliably fail in subtitle-ui's browser player (notably HDR tonemap).
func AssessBrowserPreview(plan PlaybackPlan) error {
	video := firstVideoStream(plan.MediaStreams)
	if video == nil {
		// Some PlaybackInfo responses omit streams; allow and let player fail later.
		return nil
	}
	if mediaStreamIsHDR(*video) {
		// Browser preview uses hls.js / progressive; HDR almost always needs JF tonemap
		// (OpenCL/VAAPI), which fails on many hosts (ffmpeg 237). Do not open the player.
		w, h := video.Width, video.Height
		detail := strings.TrimSpace(video.VideoRangeType)
		if detail == "" {
			detail = strings.TrimSpace(video.VideoRange)
		}
		if detail == "" {
			detail = strings.TrimSpace(video.ColorTransfer)
		}
		if detail == "" {
			detail = "HDR"
		}
		if w > 0 && h > 0 {
			return fmt.Errorf("%w: %s %dx%d video needs HDR tonemap (not supported for browser preview)", ErrPreviewUnplayable, detail, w, h)
		}
		return fmt.Errorf("%w: %s video needs HDR tonemap (not supported for browser preview)", ErrPreviewUnplayable, detail)
	}
	return nil
}

func firstVideoStream(streams []PlaybackMediaStream) *PlaybackMediaStream {
	for i := range streams {
		if strings.EqualFold(strings.TrimSpace(streams[i].Type), "Video") {
			return &streams[i]
		}
	}
	return nil
}

func mediaStreamIsHDR(s PlaybackMediaStream) bool {
	joined := strings.ToLower(strings.Join([]string{
		s.VideoRangeType,
		s.VideoRange,
		s.ColorTransfer,
	}, " "))
	if strings.TrimSpace(joined) == "" {
		return false
	}
	for _, key := range []string{
		"hdr10", "hdr", "hlg", "dovi", "dolby", "smpte2084", "arib-std-b67",
	} {
		if strings.Contains(joined, key) {
			return true
		}
	}
	return false
}

// probeMediaSource fetches PlaybackInfo without a DeviceProfile for source id + MediaStreams.
func (c *Client) probeMediaSource(ctx context.Context, itemID, userID string) (string, []PlaybackMediaStream, error) {
	body := map[string]any{
		"UserId": userID,
	}
	var resp playbackInfoResponse
	q := url.Values{}
	q.Set("UserId", userID)
	path := "/Items/" + url.PathEscape(itemID) + "/PlaybackInfo?" + q.Encode()
	if err := c.postJSON(ctx, path, body, &resp); err != nil {
		return "", nil, err
	}
	if len(resp.MediaSources) == 0 {
		return "", nil, fmt.Errorf("%w: no media sources", ErrItemNotFound)
	}
	src := resp.MediaSources[0]
	id := strings.TrimSpace(src.ID)
	if id == "" {
		// File items often use the item id as the sole media source id.
		id = itemID
	}
	streams := append([]PlaybackMediaStream(nil), src.MediaStreams...)
	return id, streams, nil
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
	// Jellyfin sometimes emits "?&key=..." which url.Parse treats poorly.
	if i := strings.Index(raw, "?&"); i >= 0 {
		raw = raw[:i+1] + raw[i+2:]
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
		// Drop embedded/sidecar burn-in; browser loads our own subtitle track.
		"SubtitleProfiles": []map[string]any{
			{"Format": "vtt", "Method": "External"},
			{"Format": "srt", "Method": "External"},
			{"Format": "ass", "Method": "Drop"},
			{"Format": "ssa", "Method": "Drop"},
			{"Format": "subrip", "Method": "Drop"},
			{"Format": "pgssub", "Method": "Drop"},
			{"Format": "dvdsub", "Method": "Drop"},
		},
	}
}
