package app

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
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

// VideoStreamSource describes how to serve a video file to the client.
type VideoStreamSource struct {
	VideoID    string
	Path       string
	FileName   string
	ModTime    time.Time
	Size       int64
	// ContentType for direct file serve (empty when Remux).
	ContentType string
	// Remux means pipe through ffmpeg to fMP4 (no reliable HTTP Range).
	Remux bool
}

var (
	ErrStreamTicketInvalid = errors.New("invalid stream ticket")
	ErrStreamTicketExpired = errors.New("stream ticket expired")
	ErrRemuxUnavailable    = errors.New("ffmpeg remux unavailable")
	ErrRemuxBusy           = errors.New("ffmpeg remux busy, try again later")
)

// TryAcquireRemuxSlot reserves a concurrent remux slot. Caller must ReleaseRemuxSlot.
func (s *Service) TryAcquireRemuxSlot() bool {
	if s == nil || s.remuxSem == nil {
		return true
	}
	select {
	case s.remuxSem <- struct{}{}:
		return true
	default:
		return false
	}
}

// ReleaseRemuxSlot frees a slot acquired via TryAcquireRemuxSlot.
func (s *Service) ReleaseRemuxSlot() {
	if s == nil || s.remuxSem == nil {
		return
	}
	select {
	case <-s.remuxSem:
	default:
	}
}

func (s *Service) IssueStreamTicket(videoID string) (StreamTicket, error) {
	videoID = strings.TrimSpace(videoID)
	if videoID == "" {
		return StreamTicket{}, fmt.Errorf("%w: video id required", ErrBadRequest)
	}
	if _, err := s.ResolveVideoStreamPath(videoID); err != nil {
		return StreamTicket{}, err
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

// ResolveVideoStreamPath returns the on-disk path for a video if it is safe and present.
func (s *Service) ResolveVideoStreamPath(videoID string) (domain.Video, error) {
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
	info, err := os.Stat(cleanPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return domain.Video{}, ErrNotFound
		}
		return domain.Video{}, err
	}
	if info.IsDir() {
		return domain.Video{}, ErrNotFound
	}
	video.Path = cleanPath
	video.FileSize = info.Size()
	video.FileModTime = info.ModTime()
	return video, nil
}

// ResolveVideoStreamSource picks direct Range serve vs optional ffmpeg remux.
// formatQuery: "", "auto", "direct", "fmp4".
func (s *Service) ResolveVideoStreamSource(videoID string, formatQuery string) (VideoStreamSource, error) {
	video, err := s.ResolveVideoStreamPath(videoID)
	if err != nil {
		return VideoStreamSource{}, err
	}

	ext := strings.ToLower(filepath.Ext(video.Path))
	fileName := strings.TrimSpace(video.FileName)
	if fileName == "" {
		fileName = filepath.Base(video.Path)
	}

	wantRemux := false
	switch strings.ToLower(strings.TrimSpace(formatQuery)) {
	case "fmp4", "mp4", "remux":
		wantRemux = true
	case "direct":
		wantRemux = false
	default: // auto / empty
		if s.cfg.StreamRemux != "off" && needsContainerRemux(ext) {
			wantRemux = true
		}
	}

	src := VideoStreamSource{
		VideoID:     video.ID,
		Path:        video.Path,
		FileName:    fileName,
		ModTime:     video.FileModTime,
		Size:        video.FileSize,
		ContentType: videoContentType(ext),
	}

	if !wantRemux {
		return src, nil
	}
	if !s.ffmpegAvailable() {
		if strings.EqualFold(strings.TrimSpace(formatQuery), "fmp4") ||
			strings.EqualFold(strings.TrimSpace(formatQuery), "mp4") ||
			strings.EqualFold(strings.TrimSpace(formatQuery), "remux") {
			return VideoStreamSource{}, ErrRemuxUnavailable
		}
		// auto: fall back to direct
		return src, nil
	}
	src.Remux = true
	src.ContentType = "video/mp4"
	src.FileName = strings.TrimSuffix(fileName, filepath.Ext(fileName)) + ".mp4"
	return src, nil
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

func (s *Service) ffmpegAvailable() bool {
	bin := s.ffmpegBinary()
	if bin == "" {
		return false
	}
	if filepath.IsAbs(bin) {
		info, err := os.Stat(bin)
		return err == nil && !info.IsDir()
	}
	_, err := exec.LookPath(bin)
	return err == nil
}

func (s *Service) ffmpegBinary() string {
	if p := strings.TrimSpace(s.cfg.FFmpegPath); p != "" {
		return p
	}
	return "ffmpeg"
}

// RemuxPreviewMaxSeconds limits optional remux length for preview (keeps temp output small).
// 0 or negative means no limit (not recommended for large MKV).
func (s *Service) RemuxPreviewMaxSeconds() int {
	// Fixed product default: first 20 minutes is enough to check subtitle sync.
	return 20 * 60
}

// FFmpegRemuxToMP4Command builds a copy-remux command writing a seekable MP4 to outPath.
// Used for MKV/AVI preview: moov at front (+faststart) so browsers can Range-seek.
func (s *Service) FFmpegRemuxToMP4Command(inputPath string, outPath string) *exec.Cmd {
	bin := s.ffmpegBinary()
	args := []string{
		"-hide_banner",
		"-nostdin",
		"-y",
		"-loglevel", "error",
	}
	if maxSec := s.RemuxPreviewMaxSeconds(); maxSec > 0 {
		args = append(args, "-t", strconv.Itoa(maxSec))
	}
	args = append(args,
		"-i", inputPath,
		// Only first video + optional first audio; drop subs/data/chapters that break remux.
		"-map", "0:v:0",
		"-map", "0:a:0?",
		"-c", "copy",
		"-sn",
		"-dn",
		"-map_chapters", "-1",
		"-map_metadata", "-1",
		"-f", "mp4",
		"-movflags", "+faststart",
		outPath,
	)
	return exec.Command(bin, args...)
}

// FFmpegRemuxCommand builds a progressive fMP4 pipe remux (legacy / fallback).
func (s *Service) FFmpegRemuxCommand(inputPath string) *exec.Cmd {
	bin := s.ffmpegBinary()
	args := []string{
		"-hide_banner",
		"-nostdin",
		"-loglevel", "error",
	}
	if maxSec := s.RemuxPreviewMaxSeconds(); maxSec > 0 {
		args = append(args, "-t", strconv.Itoa(maxSec))
	}
	args = append(args,
		"-i", inputPath,
		"-map", "0:v:0",
		"-map", "0:a:0?",
		"-c", "copy",
		"-sn",
		"-dn",
		"-map_chapters", "-1",
		"-map_metadata", "-1",
		"-f", "mp4",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"pipe:1",
	)
	return exec.Command(bin, args...)
}

func needsContainerRemux(ext string) bool {
	switch ext {
	case ".mkv", ".avi", ".ts", ".m2ts", ".mts", ".wmv", ".flv":
		return true
	default:
		return false
	}
}

func videoContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".ogg", ".ogv":
		return "video/ogg"
	case ".mkv":
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	case ".mov":
		return "video/quicktime"
	case ".ts", ".m2ts", ".mts":
		return "video/mp2t"
	default:
		return "application/octet-stream"
	}
}

func randomNonce(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
