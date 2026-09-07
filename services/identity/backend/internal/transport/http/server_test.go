package identityhttp

import (
	"net"
	"net/http/httptest"
	"testing"

	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

func mustNetwork(t *testing.T, cidr string) *net.IPNet {
	t.Helper()
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		t.Fatalf("parse trusted network %q: %v", cidr, err)
	}
	return network
}

func TestClientIPUsesTrustedChainAndCIDR(t *testing.T) {
	server := &Server{config: Config{TrustedProxies: []*net.IPNet{mustNetwork(t, "10.0.0.0/8")}}}
	request := httptest.NewRequest("POST", "/auth/managed/login", nil)
	request.RemoteAddr = "10.20.30.40:1234"
	request.Header.Set("X-Forwarded-For", "198.18.0.9, 10.1.2.3")

	if got := server.clientIP(request); got != "198.18.0.9" {
		t.Fatalf("clientIP() = %q, want first untrusted address in chain", got)
	}
}

func TestClientIPIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	server := &Server{config: Config{TrustedProxies: []*net.IPNet{mustNetwork(t, "10.0.0.0/8")}}}
	request := httptest.NewRequest("POST", "/auth/managed/login", nil)
	request.RemoteAddr = "192.0.2.40:1234"
	request.Header.Set("X-Forwarded-For", "198.18.0.9")

	if got := server.clientIP(request); got != "192.0.2.40" {
		t.Fatalf("clientIP() = %q, want untrusted peer", got)
	}
}

func TestIPHashUsesCanonicalClientIPAndAbuseKey(t *testing.T) {
	secret := []byte("01234567890123456789012345678901")
	server := &Server{config: Config{AbuseIPSecret: secret, TrustedProxies: []*net.IPNet{mustNetwork(t, "10.0.0.0/8")}}}
	request := httptest.NewRequest("POST", "/auth/managed/login", nil)
	request.RemoteAddr = "10.20.30.40:1234"
	request.Header.Set("X-Forwarded-For", "198.18.0.9, 10.1.2.3")

	want := identitysecurity.HMAC256Hex(secret, "client-ip", "198.18.0.9")
	if got := server.ipHash(request); got != want {
		t.Fatalf("ipHash() = %q, want keyed hash of canonical client IP", got)
	}
}
