package identityhttp

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
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

func TestWriteDomainErrorPreservesRefreshStaleContract(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		statusCode int
		code       string
	}{
		{name: "refresh stale", err: domain.ErrRefreshStale, statusCode: 401, code: "REFRESH_STALE"},
		{name: "invalid refresh", err: domain.ErrInvalidRefresh, statusCode: 401, code: "UNAUTHENTICATED"},
		{name: "actor security disabled", err: domain.ErrActorSecurityDisabled, statusCode: http.StatusConflict, code: "ACTOR_SECURITY_DISABLED"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeDomainError(response, test.err)

			if response.Code != test.statusCode {
				t.Fatalf("status = %d, want %d", response.Code, test.statusCode)
			}
			if !strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
				t.Fatalf("body = %q, want code %q", response.Body.String(), test.code)
			}
		})
	}
}

func TestDevelopmentSessionRouteIsAbsentOutsideDevelopment(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{})
	request := httptest.NewRequest(http.MethodPost, "/auth/development/session", strings.NewReader("{}"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("non-development route status = %d, want 404", response.Code)
	}
}

func TestDevelopmentSessionRouteIsRegisteredOnlyInDevelopment(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{Development: true})
	request := httptest.NewRequest(http.MethodPost, "/auth/development/session", strings.NewReader("{}"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("development route status = %d, want 400 for invalid request proving route registration", response.Code)
	}
}

func TestManagedRecoveryRoutesAreRegistered(t *testing.T) {
	for _, path := range []string{"/auth/managed/recovery/request", "/auth/managed/recover"} {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
		response := httptest.NewRecorder()
		New(nil, nil, nil, nil, nil, Config{}).ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Errorf("POST %s status = %d, want %d for malformed JSON on a registered route", path, response.Code, http.StatusBadRequest)
		}
	}
}

func TestProvisionExistingRoleRequiresCorrelationID(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{InternalServiceTokens: map[string]string{"dsh": "identity-service-token"}})
	request := httptest.NewRequest(http.MethodPost, "/internal/actors/actor-1/roles/partner/provision", nil)
	request.Header.Set("Authorization", "Bearer identity-service-token")
	request.Header.Set("X-Acting-Actor-ID", "operator-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("missing correlation ID status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if !strings.Contains(response.Body.String(), `"code":"INVALID_INPUT"`) {
		t.Fatalf("missing correlation ID error = %q, want INVALID_INPUT", response.Body.String())
	}
}

func TestCanonicalActorResolutionIsNotAvailableToControlPanel(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{InternalServiceTokens: map[string]string{"control-panel": "control-panel-service-token"}})
	request := httptest.NewRequest(http.MethodGet, "/internal/actors/actor-1", nil)
	request.Header.Set("Authorization", "Bearer control-panel-service-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("Control Panel canonical Actor read status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if !strings.Contains(response.Body.String(), `"code":"FORBIDDEN"`) {
		t.Fatalf("Control Panel canonical Actor read error = %q, want FORBIDDEN", response.Body.String())
	}
}
