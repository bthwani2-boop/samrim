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
	managed, err := New(identityClient, "control-panel-service-token-123456789")
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
