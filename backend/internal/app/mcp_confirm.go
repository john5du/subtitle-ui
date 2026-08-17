package app

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"time"
)

const defaultMCPConfirmTTL = 10 * time.Minute

// ConfirmTokenIssue is returned by preview tools.
type ConfirmTokenIssue struct {
	ConfirmToken string    `json:"confirmToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Tool         string    `json:"tool"`
	TTLSeconds   int       `json:"ttlSeconds"`
}

type confirmEnvelope struct {
	V     int    `json:"v"`
	Tool  string `json:"tool"`
	Hash  string `json:"hash"`
	Exp   int64  `json:"exp"`
	Nonce string `json:"nonce"`
	Mac   string `json:"mac"`
}

// usedConfirmNonces tracks single-use tokens until expiry (process-local).
type usedConfirmNonces struct {
	mu   sync.Mutex
	byID map[string]int64 // nonce -> exp unix
}

func (c *usedConfirmNonces) consume(nonce string, exp int64) bool {
	if c == nil || nonce == "" {
		return false
	}
	now := time.Now().UTC().Unix()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.byID == nil {
		c.byID = make(map[string]int64)
	}
	// Opportunistic prune.
	if len(c.byID) > 256 {
		for k, e := range c.byID {
			if e < now {
				delete(c.byID, k)
			}
		}
	}
	if e, ok := c.byID[nonce]; ok {
		if e >= now {
			return false // already used
		}
		delete(c.byID, nonce)
	}
	c.byID[nonce] = exp
	return true
}

// IssueMCPConfirmToken signs a short-lived single-use token for a dangerous MCP tool + params hash.
func (s *Service) IssueMCPConfirmToken(tool string, params any) (ConfirmTokenIssue, error) {
	tool = strings.TrimSpace(tool)
	if tool == "" {
		return ConfirmTokenIssue{}, fmt.Errorf("%w: missing tool", ErrBadRequest)
	}
	hash, err := hashConfirmParams(params)
	if err != nil {
		return ConfirmTokenIssue{}, fmt.Errorf("%w: %v", ErrBadRequest, err)
	}
	nonce, err := randomConfirmNonce()
	if err != nil {
		return ConfirmTokenIssue{}, err
	}
	ttl := defaultMCPConfirmTTL
	exp := time.Now().UTC().Add(ttl)
	mac, err := s.signConfirm(tool, hash, exp.Unix(), nonce)
	if err != nil {
		return ConfirmTokenIssue{}, err
	}
	env := confirmEnvelope{V: 2, Tool: tool, Hash: hash, Exp: exp.Unix(), Nonce: nonce, Mac: mac}
	raw, err := json.Marshal(env)
	if err != nil {
		return ConfirmTokenIssue{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return ConfirmTokenIssue{
		ConfirmToken: token,
		ExpiresAt:    exp,
		Tool:         tool,
		TTLSeconds:   int(ttl.Seconds()),
	}, nil
}

// ValidateMCPConfirmToken checks token matches tool + params, is unexpired, and not yet consumed.
func (s *Service) ValidateMCPConfirmToken(tool string, params any, token string) error {
	tool = strings.TrimSpace(tool)
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("%w: confirmToken required — call the matching preview tool first", ErrBadRequest)
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return fmt.Errorf("%w: invalid confirmToken encoding", ErrBadRequest)
	}
	var env confirmEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("%w: invalid confirmToken", ErrBadRequest)
	}
	if env.V != 2 {
		return fmt.Errorf("%w: unsupported confirmToken version", ErrBadRequest)
	}
	if env.Tool != tool {
		return fmt.Errorf("%w: confirmToken tool mismatch (got %q want %q)", ErrBadRequest, env.Tool, tool)
	}
	if time.Now().UTC().Unix() > env.Exp {
		return fmt.Errorf("%w: confirmToken expired — request a new preview", ErrBadRequest)
	}
	hash, err := hashConfirmParams(params)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrBadRequest, err)
	}
	if !hmac.Equal([]byte(env.Hash), []byte(hash)) {
		return fmt.Errorf("%w: confirmToken params mismatch — re-run preview with the same arguments", ErrBadRequest)
	}
	wantMac, err := s.signConfirm(tool, hash, env.Exp, env.Nonce)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(env.Mac), []byte(wantMac)) {
		return fmt.Errorf("%w: confirmToken signature invalid", ErrBadRequest)
	}
	if env.Nonce == "" {
		return fmt.Errorf("%w: confirmToken missing nonce", ErrBadRequest)
	}
	if ok, err := s.consumeConfirmNonce(env.Nonce, env.Exp); err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("%w: confirmToken already used — request a new preview", ErrBadRequest)
	}
	return nil
}

func (s *Service) consumeConfirmNonce(nonce string, expUnix int64) (bool, error) {
	exp := time.Unix(expUnix, 0).UTC()
	if s != nil && s.store != nil {
		return s.store.ConsumeConfirmNonce(nonce, exp)
	}
	return s.confirmNonces.consume(nonce, expUnix), nil
}

func (s *Service) mcpConfirmSecret() string {
	if s != nil {
		if secret := strings.TrimSpace(s.cfg.MCPConfirmSecret); secret != "" {
			return secret
		}
	}
	return s.streamTicketSecret()
}

func (s *Service) signConfirm(tool, hash string, exp int64, nonce string) (string, error) {
	secret := s.mcpConfirmSecret()
	if secret == "" {
		return "", fmt.Errorf("%w: no secret for confirm tokens", ErrBadRequest)
	}
	payload := fmt.Sprintf("mcp-confirm|v2|%s|%s|%d|%s", tool, hash, exp, nonce)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func hashConfirmParams(params any) (string, error) {
	normalized := normalizeConfirmParams(params)
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// normalizeConfirmParams makes nil/empty optional fields hash identically
// (omit null, empty string, empty array/object from maps).
func normalizeConfirmParams(params any) any {
	if params == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(params)
	if err != nil {
		return params
	}
	var asAny any
	if err := json.Unmarshal(raw, &asAny); err != nil {
		return params
	}
	return normalizeJSONValue(asAny)
}

func normalizeJSONValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if isEmptyConfirmValue(val) {
				continue
			}
			out[k] = normalizeJSONValue(val)
		}
		return out
	case []any:
		out := make([]any, 0, len(t))
		for _, val := range t {
			out = append(out, normalizeJSONValue(val))
		}
		return out
	default:
		return v
	}
}

func isEmptyConfirmValue(v any) bool {
	if v == nil {
		return true
	}
	switch t := v.(type) {
	case string:
		return t == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	default:
		rv := reflect.ValueOf(v)
		if rv.IsValid() && rv.Kind() == reflect.Slice && rv.Len() == 0 {
			return true
		}
		return false
	}
}

func randomConfirmNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
