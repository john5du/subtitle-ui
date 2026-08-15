package api

import (
	"net/http/httptest"
	"testing"
)

func TestRequestRemoteAddrHonorsTrustForwardedHeaders(t *testing.T) {
	req := httptest.NewRequest("GET", "http://example.test/api/videos", nil)
	req.RemoteAddr = "10.0.0.8:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.2")

	if got := requestRemoteAddr(req, false); got != "10.0.0.8" {
		t.Fatalf("untrusted forwarded headers returned %q", got)
	}
	if got := requestRemoteAddr(req, true); got != "203.0.113.9" {
		t.Fatalf("trusted forwarded headers returned %q", got)
	}
}
