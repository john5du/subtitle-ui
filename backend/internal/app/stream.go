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
	streamTicketVersion = "v1"
	streamTicketParts   = 5 // v1|videoID|exp|nonce|mac
)

// StreamTicket is a short-lived grant to stream one video without Bearer auth.
type StreamTicket struct {
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt"`
	URL       string    `json:"url"`
}

var (
	ErrStreamTicketInvalid = errors.New("invalid stream ticket")
	ErrStreamTicketExpired = errors.New("stream ticket expired")
)

// IssueStreamTicket issues a ticket for Jellyfin-proxied preview streaming.
// Requires Jellyfin enabled and a resolvable library item for the video path.
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
	if _, err := client.FindItemIDByPath(ctx, video.Path); err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return StreamTicket{}, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		return StreamTicket{}, fmt.Errorf("%w: jellyfin item: %v", ErrNotFound, err)
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
	ticket, err := s.signStreamTicket(videoID, exp.Unix(), nonce)
	if err != nil {
		return StreamTicket{}, err
	}
	return StreamTicket{
		Ticket:    ticket,
		ExpiresAt: exp,
		URL:       "/api/videos/" + url.PathEscape(videoID) + "/stream?ticket=" + url.QueryEscape(ticket),
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

// OpenJellyfinVideoStream resolves the video to a Jellyfin item and opens a static stream.
// Caller must Close the returned Body.
func (s *Service) OpenJellyfinVideoStream(ctx context.Context, videoID, method, rangeHeader string) (*jellyfin.StreamResponse, error) {
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return nil, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
	}
	video, err := s.ResolveVideoForStream(videoID)
	if err != nil {
		return nil, err
	}
	itemID, err := client.FindItemIDByPath(ctx, video.Path)
	if err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return nil, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		return nil, fmt.Errorf("%w: jellyfin item: %v", ErrNotFound, err)
	}
	resp, err := client.OpenVideoStream(ctx, method, itemID, rangeHeader)
	if err != nil {
		return nil, fmt.Errorf("jellyfin stream: %w", err)
	}
	return resp, nil
}

func (s *Service) ValidateStreamTicket(videoID string, ticket string) error {
	videoID = strings.TrimSpace(videoID)
	ticket = strings.TrimSpace(ticket)
	if videoID == "" || ticket == "" {
		return ErrStreamTicketInvalid
	}
	parts := strings.Split(ticket, ".")
	if len(parts) != streamTicketParts {
		return ErrStreamTicketInvalid
	}
	if parts[0] != streamTicketVersion {
		return ErrStreamTicketInvalid
	}
	if parts[1] != videoID {
		return ErrStreamTicketInvalid
	}
	expUnix, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || expUnix <= 0 {
		return ErrStreamTicketInvalid
	}
	if time.Now().UTC().Unix() > expUnix {
		return ErrStreamTicketExpired
	}
	nonce := parts[3]
	macHex := parts[4]
	expected, err := s.streamTicketMAC(videoID, expUnix, nonce)
	if err != nil {
		return ErrStreamTicketInvalid
	}
	if !hmac.Equal([]byte(macHex), []byte(expected)) {
		return ErrStreamTicketInvalid
	}
	return nil
}

func (s *Service) signStreamTicket(videoID string, expUnix int64, nonce string) (string, error) {
	mac, err := s.streamTicketMAC(videoID, expUnix, nonce)
	if err != nil {
		return "", err
	}
	return strings.Join([]string{
		streamTicketVersion,
		videoID,
		strconv.FormatInt(expUnix, 10),
		nonce,
		mac,
	}, "."), nil
}

func (s *Service) streamTicketMAC(videoID string, expUnix int64, nonce string) (string, error) {
	secret := s.streamTicketSecret()
	if secret == "" {
		return "", fmt.Errorf("%w: stream ticket secret empty", ErrBadRequest)
	}
	payload := streamTicketVersion + "|" + videoID + "|" + strconv.FormatInt(expUnix, 10) + "|" + nonce
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
