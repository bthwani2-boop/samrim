package managedaccess

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityboundary"
)

func TestProvisionManagedRoleUsesAuthenticatedIdentityBoundary(t *testing.T) {
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/internal/actor-roles/provision" {
			t.Fatalf("unexpected identity request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer identity-service-token-123456789" {
			t.Fatalf("identity service credential was not forwarded")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode identity request: %v", err)
		}
		if body["phoneE164"] != "+967777000112" || body["role"] != "captain" {
			t.Fatalf("unexpected identity request body: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"actorId":"act_test","phoneE164":"+967777000112","role":"captain","enabled":true,"securityEnabled":true,"actorVersion":1,"roleVersion":1,"actorCreated":true,"roleCreated":true}`))
	}))
	defer identityServer.Close()

	identityClient, err := identityboundary.New(identityServer.URL, "identity-service-token-123456789")
	if err != nil {
		t.Fatal(err)
	}
	const accessToken = "control-panel-service-token-123456789"
	managed, err := New(identityClient, accessToken)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	managed.Register(mux)

	request := httptest.NewRequest(http.MethodPost, "/dsh/managed-roles/provision", strings.NewReader(`{"phoneE164":"+967777000112","role":"captain"}`))
	request.Header.Set("Authorization", "Bearer control-panel-service-token-123456789")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProvisionManagedRoleRejectsMissingAuthority(t *testing.T) {
	identityClient, err := identityboundary.New("http://identity.invalid", "identity-service-token-123456789")
	if err != nil {
		t.Fatal(err)
	}
	managed, err := New(identityClient, "control-panel-service-token-123456789")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	managed.Register(mux)
	request := httptest.NewRequest(http.MethodPost, "/dsh/managed-roles/provision", strings.NewReader(`{"phoneE164":"+967777000112","role":"captain"}`))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestReenrollByPhoneResolvesCanonicalActorBeforeAuthorization(t *testing.T) {
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/internal/actor-roles/search" {
			if r.URL.Query().Get("role") != "captain" || r.URL.Query().Get("q") != "773 777 000 112" || r.URL.Query().Get("enabled") != "true" {
				t.Fatalf("unexpected identity search query: %s", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[{"actorId":"act_test","phoneE164":"+967777000112","role":"captain","enabled":true,"securityEnabled":true}],"limit":2}`))
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/internal/actors/act_test/roles/captain/reenrollment" {
			t.Fatalf("unexpected identity reenrollment request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("X-Correlation-ID") != "correlation-test" {
			t.Fatalf("correlation id was not forwarded")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer identityServer.Close()

	identityClient, err := identityboundary.New(identityServer.URL, "identity-service-token-123456789")
	if err != nil {
		t.Fatal(err)
	}
	const accessToken = "control-panel-service-token-123456789"
	managed, err := New(identityClient, accessToken)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	managed.Register(mux)

	request := httptest.NewRequest(http.MethodPost, "/dsh/managed-roles/reenrollment", strings.NewReader(`{"phoneE164":"773 777 000 112","role":"captain"}`))
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("X-Correlation-ID", "correlation-test")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestStatusByPhoneReadsCanonicalIdentityState(t *testing.T) {
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/internal/actor-roles/search" {
			t.Fatalf("unexpected identity request: %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("role") != "captain" || r.URL.Query().Get("enabled") != "true" {
			t.Fatalf("unexpected identity search query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"actorId":"act_test","phoneE164":"+967777000112","role":"captain","enabled":true,"activatedAt":"2026-09-06T00:00:00Z","securityEnabled":true}],"limit":2}`))
	}))
	defer identityServer.Close()

	identityClient, err := identityboundary.New(identityServer.URL, "identity-service-token-123456789")
	if err != nil {
		t.Fatal(err)
	}
	const accessToken = "control-panel-service-token-123456789"
	managed, err := New(identityClient, accessToken)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	managed.Register(mux)

	request := httptest.NewRequest(http.MethodGet, "/dsh/managed-roles/status?phoneE164=773%20777%20000%20112&role=captain", nil)
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body roleStatusResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Exists || !body.Enabled || !body.Activated || !body.Recoverable || body.Role != "captain" {
		t.Fatalf("unexpected role status: %#v", body)
	}
}
