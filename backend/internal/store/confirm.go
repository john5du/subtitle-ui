package store

import (
	"time"
)

func (s *Store) ConsumeConfirmNonce(nonce string, exp time.Time) (bool, error) {
	if s == nil || nonce == "" {
		return false, nil
	}
	cutoff := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	_, _ = s.exec(`DELETE FROM mcp_confirm_nonces WHERE exp < ?`, cutoff)

	expValue := exp.UTC().Format(time.RFC3339Nano)
	res, err := s.exec(
		`INSERT INTO mcp_confirm_nonces(nonce, exp) VALUES(?, ?) ON CONFLICT(nonce) DO NOTHING`,
		nonce,
		expValue,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
