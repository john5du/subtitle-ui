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
	// v1.videoID.itemID.exp.nonce.mac
	streamTicketParts = 6
)

// StreamTicket is a short-lived grant to stream one video without Bearer auth.
// The signed ticket embeds the Jellyfin item id so Range requests do not re-resolve paths.
type StreamTicket struct {
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expiresAt"`
	URL       string    `json:"url"`
}

// StreamTicketClaims is the verified payload of a stream ticket.
type StreamTicketClaims struct {
	VideoID string
	ItemID  string
	ExpUnix int64
}

var (
	ErrStreamTicketInvalid = errors.New("invalid stream ticket")
	ErrStreamTicketExpired = errors.New("stream ticket expired")
)

// IssueStreamTicket issues a ticket for Jellyfin-proxied preview streaming.
// Requires Jellyfin enabled and a resolvable library item for the video path.
// The Jellyfin item id is embedded in the ticket (signed) so stream GETs skip path lookup.
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
		// Network/auth/5xx/decode — keep as upstream failure (HTTP 500), not 404.
		return StreamTicket{}, fmt.Errorf("jellyfin item lookup: %w", err)
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" || strings.Contains(itemID, ".") {
		return StreamTicket{}, fmt.Errorf("%w: jellyfin item id invalid", ErrNotFound)
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
	ticket, err := s.signStreamTicket(videoID, itemID, exp.Unix(), nonce)
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

// OpenJellyfinVideoStream opens a static Jellyfin stream for a known item id (from a verified ticket).
// Does not re-resolve path → item. Caller must Close the returned Body.
func (s *Service) OpenJellyfinVideoStream(ctx context.Context, itemID, method, rangeHeader string) (*jellyfin.StreamResponse, error) {
	client := s.jellyfinClient()
	if client == nil || !client.Enabled() {
		return nil, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return nil, fmt.Errorf("%w: jellyfin item id required", ErrBadRequest)
	}
	resp, err := client.OpenVideoStream(ctx, method, itemID, rangeHeader)
	if err != nil {
		if errors.Is(err, jellyfin.ErrDisabled) {
			return nil, fmt.Errorf("%w: jellyfin", ErrProviderDisabled)
		}
		return nil, fmt.Errorf("jellyfin stream: %w", err)
	}
	return resp, nil
}

// ValidateStreamTicket verifies the ticket for videoID and returns signed claims (including item id).
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
	if parts[1] != videoID {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	itemID := parts[2]
	if itemID == "" || strings.Contains(itemID, ".") {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	expUnix, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil || expUnix <= 0 {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	if time.Now().UTC().Unix() > expUnix {
		return StreamTicketClaims{}, ErrStreamTicketExpired
	}
	nonce := parts[4]
	macHex := parts[5]
	expected, err := s.streamTicketMAC(videoID, itemID, expUnix, nonce)
	if err != nil {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	if !hmac.Equal([]byte(macHex), []byte(expected)) {
		return StreamTicketClaims{}, ErrStreamTicketInvalid
	}
	return StreamTicketClaims{
		VideoID: videoID,
		ItemID:  itemID,
		ExpUnix: expUnix,
	}, nil
}

func (s *Service) signStreamTicket(videoID, itemID string, expUnix int64, nonce string) (string, error) {
	mac, err := s.streamTicketMAC(videoID, itemID, expUnix, nonce)
	if err != nil {
		return "", err
	}
	return strings.Join([]string{
		streamTicketVersion,
		videoID,
		itemID,
		strconv.FormatInt(expUnix, 10),
		nonce,
		mac,
	}, "."), nil
}

func (s *Service) streamTicketMAC(videoID, itemID string, expUnix int64, nonce string) (string, error) {
	secret := s.streamTicketSecret()
	if secret == "" {
		return "", fmt.Errorf("%w: stream ticket secret empty", ErrBadRequest)
	}
	payload := streamTicketVersion + "|" + videoID + "|" + itemID + "|" + strconv.FormatInt(expUnix, 10) + "|" + nonce
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
