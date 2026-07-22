package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/provider/jellyfin"
	"subtitle-ui/backend/internal/subtitle"
)

const (
	streamTicketVersion = "v2"
	// v2.videoID.itemID.mode.exp.nonce.upB64.mac
	streamTicketParts = 8

	streamModeHLS         = "h"
	streamModeProgressive = "p"
)

// StreamTicket is a short-lived grant to stream one video without Bearer auth.
// Ticket embeds Jellyfin item id, mode (hls/progressive), and upstream path (signed).
type StreamTicket struct {
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt"`
	URL       string    `json:"url"`
	Kind      string    `json:"kind"` // "hls" | "progressive"
}

// StreamTicketClaims is the verified payload of a stream ticket.
type StreamTicketClaims struct {
	VideoID      string
	ItemID       string
	Mode         string // hls | progressive
	UpstreamPath string
	ExpUnix      int64
}

var (
	ErrStreamTicketInvalid = errors.New("invalid stream ticket")
	ErrStreamTicketExpired = errors.New("stream ticket expired")
)

// IssueStreamTicket issues a ticket for Jellyfin-proxied preview streaming.
// Uses PlaybackInfo so Jellyfin can audio-transcode (EAC3→AAC) via HLS when needed.
func (s *Service) IssueStreamTicket(ctx context.Context, videoID string) (StreamTicket, error) {
	videoID = strings.TrimSpace(videoID)
	if videoID == "" {
		return StreamTicket{}, fmt.Errorf("%w: video id required", ErrBadRequest)
	}
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return StreamTicket{}, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
	}
	video, err := s.ResolveVideoForStream(videoID)
	if err != nil {
		return StreamTicket{}, err
	}
	itemID, err := client.FindItemIDByPath(ctx, video.Path)
	if err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return StreamTicket{}, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		if errors.Is(err, jellyfin.ErrItemNotFound) {
			return StreamTicket{}, fmt.Errorf("%w: jellyfin item: %w", ErrNotFound, err)
		}
		return StreamTicket{}, fmt.Errorf("jellyfin item lookup: %w", err)
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return StreamTicket{}, fmt.Errorf("%w: jellyfin item id invalid", ErrNotFound)
	}

	plan, err := client.ResolvePlaybackPlan(ctx, itemID)
	if err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return StreamTicket{}, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		if errors.Is(err, jellyfin.ErrItemNotFound) {
			return StreamTicket{}, fmt.Errorf("%w: jellyfin item: %w", ErrNotFound, err)
		}
		// Metadata-based preview gate (HDR etc.) — no stream probe.
		if errors.Is(err, jellyfin.ErrPreviewUnplayable) {
			return StreamTicket{}, fmt.Errorf("%w: %s", ErrPreviewUnavailable, err.Error())
		}
		return StreamTicket{}, fmt.Errorf("jellyfin playback info: %w", err)
	}
	if err := jellyfin.ValidateUpstreamPath(plan.UpstreamPath); err != nil {
		return StreamTicket{}, fmt.Errorf("jellyfin playback path: %w", err)
	}

	modeCode := streamModeProgressive
	kind := jellyfin.PlaybackModeProgressive
	if plan.Mode == jellyfin.PlaybackModeHLS {
		modeCode = streamModeHLS
		kind = jellyfin.PlaybackModeHLS
	}

	ttl := s.cfg.StreamTicketTTL
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	exp := time.Now().UTC().Add(ttl)
	nonce, err := randomNonce(8)
	if err != nil {
		return StreamTicket{}, err
	}
	ticket, err := s.signStreamTicket(videoID, itemID, modeCode, exp.Unix(), nonce, plan.UpstreamPath)
	if err != nil {
		return StreamTicket{}, err
	}

	publicURL := "/api/videos/" + url.PathEscape(videoID) + "/stream?ticket=" + url.QueryEscape(ticket)
	if kind == jellyfin.PlaybackModeHLS {
		publicURL = "/api/videos/" + url.PathEscape(videoID) + "/hls/master?ticket=" + url.QueryEscape(ticket)
	}
	return StreamTicket{
		Ticket:    ticket,
		ExpiresAt: exp,
		URL:       publicURL,
		Kind:      kind,
	}, nil
}

// ResolveVideoForStream returns library video metadata for streaming (path need not exist on disk).
func (s *Service) ResolveVideoForStream(videoID string) (domain.Video, error) {
	video, found, err := s.store.GetVideo(videoID)
	if err != nil {
		return domain.Video{}, err
	}
	if !found {
		return domain.Video{}, ErrNotFound
	}
	cleanPath := filepath.Clean(strings.TrimSpace(video.Path))
	if cleanPath == "" || cleanPath == "." {
		return domain.Video{}, ErrNotFound
	}
	if !s.isSafeMediaPath(cleanPath) {
		return domain.Video{}, ErrUnsafePath
	}
	video.Path = cleanPath
	return video, nil
}

// OpenJellyfinUpstream opens the Jellyfin URL embedded in a verified ticket (progressive or HLS segment).
func (s *Service) OpenJellyfinUpstream(ctx context.Context, upstreamPath, method, rangeHeader string) (*jellyfin.StreamResponse, error) {
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return nil, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
	}
	resp, err := client.OpenAuthenticatedPath(ctx, method, upstreamPath, rangeHeader)
	if err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return nil, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		return nil, fmt.Errorf("jellyfin stream: %w", err)
	}
	return resp, nil
}

// RewriteHLSPlaylist rewrites m3u8 body so segment URIs hit our ticket-gated proxy.
func (s *Service) RewriteHLSPlaylist(playlist string, videoID, ticket, upstreamPlaylistPath string) string {
	videoID = strings.TrimSpace(videoID)
	ticket = strings.TrimSpace(ticket)
	return jellyfin.RewriteM3U8(playlist, upstreamPlaylistPath, func(up string) string {
		return "/api/videos/" + url.PathEscape(videoID) + "/hls/seg?ticket=" + url.QueryEscape(ticket) +
			"&u=" + url.QueryEscape(up)
	})
}

// ValidateStreamTicket verifies the ticket for videoID and returns signed claims.
func (s *Service) ValidateStreamTicket(videoID string, ticket string) (StreamTicketClaims, error) {
	videoID = strings.TrimSpace(videoID)
	ticket = strings.TrimSpace(ticket)
	if videoID == "" || ticket == "" {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	parts := strings.Split(ticket, ".")
	if len(parts) != streamTicketParts {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	if parts[0] != streamTicketVersion {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	ticketVideoID, err := decodeTicketField(parts[1])
	if err != nil || ticketVideoID != videoID {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	itemID, err := decodeTicketField(parts[2])
	if err != nil || itemID == "" {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	modeCode := parts[3]
	var mode string
	switch modeCode {
	case streamModeHLS:
		mode = jellyfin.PlaybackModeHLS
	case streamModeProgressive:
		mode = jellyfin.PlaybackModeProgressive
	default:
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	expUnix, err := strconv.ParseInt(parts[4], 10, 64)
	if err != nil || expUnix <= 0 {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	if time.Now().UTC().Unix() > expUnix {
		return StreamTicketClaims{}, ErrStreamTicketExpired
	}
	nonce := parts[5]
	upB64 := parts[6]
	macHex := parts[7]
	expected, err := s.streamTicketMAC(videoID, itemID, modeCode, expUnix, nonce, upB64)
	if err != nil {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	if !hmac.Equal([]byte(macHex), []byte(expected)) {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	upRaw, err := base64.RawURLEncoding.DecodeString(upB64)
	if err != nil || len(upRaw) == 0 {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	upstreamPath := string(upRaw)
	if err := jellyfin.ValidateUpstreamPath(upstreamPath); err != nil {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	return StreamTicketClaims{
		VideoID:      videoID,
		ItemID:       itemID,
		Mode:         mode,
		UpstreamPath: upstreamPath,
		ExpUnix:      expUnix,
	}, nil
}

func (s *Service) signStreamTicket(videoID, itemID, modeCode string, expUnix int64, nonce, upstreamPath string) (string, error) {
	upB64 := base64.RawURLEncoding.EncodeToString([]byte(upstreamPath))
	mac, err := s.streamTicketMAC(videoID, itemID, modeCode, expUnix, nonce, upB64)
	if err != nil {
		return "", err
	}
	// videoID/itemID are base64 so '.' inside them cannot break field splitting.
	return strings.Join([]string{
		streamTicketVersion,
		encodeTicketField(videoID),
		encodeTicketField(itemID),
		modeCode,
		strconv.FormatInt(expUnix, 10),
		nonce,
		upB64,
		mac,
	}, "."), nil
}

func encodeTicketField(s string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(s))
}

func decodeTicketField(s string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("empty ticket field")
	}
	return string(raw), nil
}

func (s *Service) streamTicketMAC(videoID, itemID, modeCode string, expUnix int64, nonce, upB64 string) (string, error) {
	secret := s.streamTicketSecret()
	if secret == "" {
		return "", fmt.Errorf("%w: stream ticket secret empty", ErrBadRequest)
	}
	payload := streamTicketVersion + "|" + videoID + "|" + itemID + "|" + modeCode + "|" +
		strconv.FormatInt(expUnix, 10) + "|" + nonce + "|" + upB64
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) streamTicketSecret() string {
	if secret := strings.TrimSpace(s.cfg.StreamTicketSecret); secret != "" {
		return secret
	}
	return strings.TrimSpace(s.cfg.AdminToken)
}

func (s *Service) isSafeMediaPath(targetPath string) bool {
	if subtitle.EnsureWithinRoot(s.cfg.MovieMediaRoot, targetPath) {
		return true
	}
	return subtitle.EnsureWithinRoot(s.cfg.TVMediaRoot, targetPath)
}

func randomNonce(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
