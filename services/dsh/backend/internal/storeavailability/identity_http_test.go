package storeavailability

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testOpaqueIdentityToken() string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x25}, 32))
}

func TestIdentityHTTPVerifiesCurrentSessionOnEveryUse(t *testing.T) {
	token := testOpaqueIdentityToken()
	var reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer "+token ||
			r.Header.Get("Accept") != "application/json" {
			t.Errorf("unexpected Identity verification request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.URL.Path == "/v1/operators/me/permissions/operations" {
			// This test only provisions current sessions, not an effective grant.
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/v1/sessions/current" {
			t.Errorf("unexpected Identity path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		reads.Add(1)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"actorId":          "merchant-one",
			"role":             "merchant",
			"sessionExpiresAt": time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339),
		})
	}))
	defer server.Close()
	client, err := NewIdentitySessionHTTP(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		actor, err := client.ResolveCurrentSession(context.Background(), token)
		if err != nil || actor.Subject != "merchant-one" || actor.Role != MerchantRole {
			t.Fatalf("wrong identity %+v err=%v", actor, err)
		}
	}
	if reads.Load() != 2 {
		t.Fatalf("cached Identity session despite revocation risk: calls=%d", reads.Load())
	}
	if err := client.RequireOperatorPermission(context.Background(), token, "merchant-one", "operations"); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("unavailable effective grant accepted: %v", err)
	}
}

func TestIdentityHTTPRejectsUnverifiedAndMalformedOwnerResponses(t *testing.T) {
	token := testOpaqueIdentityToken()
	tests := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"revoked", 401, `{"error":"UNAUTHORIZED"}`, ErrUnauthorized},
		{"owner unavailable", 503, `{"error":"OWNER_UNAVAILABLE"}`, ErrIdentityUnavailable},
		{"unknown role", 200, `{"actorId":"someone","role":"root","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"expired", 200, `{"actorId":"merchant-one","role":"merchant","sessionExpiresAt":"2020-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"unknown field", 200, `{"actorId":"merchant-one","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z","admin":true}`, ErrIdentityUnavailable},
		{"empty actor", 200, `{"actorId":"","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"bad JSON", 200, `{"actorId":`, ErrIdentityUnavailable},
		{"oversized", 200, strings.Repeat("x", 4097), ErrIdentityUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			client, err := NewIdentitySessionHTTP(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			actor, err := client.ResolveCurrentSession(context.Background(), token)
			if !errors.Is(err, tc.want) || actor.Subject != "" {
				t.Fatalf("untrusted owner response accepted: actor=%+v err=%v", actor, err)
			}
		})
	}
}

func TestIdentityHTTPRejectsRedirectAndUntrustedEndpoint(t *testing.T) {
	token := testOpaqueIdentityToken()
	var leaked atomic.Bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked.Store(r.Header.Get("Authorization") != "")
		w.WriteHeader(200)
	}))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/v1/sessions/current", http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	client, err := NewIdentitySessionHTTP(redirect.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.ResolveCurrentSession(context.Background(), token); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("followed untrusted Identity redirect: %v", err)
	}
	if leaked.Load() {
		t.Fatal("opaque Identity token leaked across redirect")
	}
	for _, url := range []string{
		"http://example.org",
		"http://user:pass@127.0.0.1:3302",
		"http://127.0.0.1:3302/unexpected",
		"https://identity.example.org/extra",
		"ftp://localhost:3302",
	} {
		if _, err := NewIdentitySessionHTTP(url); err == nil {
			t.Fatalf("unsafe Identity endpoint allowed: %s", url)
		}
	}
}

func TestIdentityHTTPRevocationAndUnavailableNeverReusePreviousActor(t *testing.T) {
	token := testOpaqueIdentityToken()
	var reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := reads.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if attempt == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"actorId":          "merchant-one",
				"role":             "merchant",
				"sessionExpiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			})
		} else {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"UNAUTHORIZED"}`))
		}
	}))
	defer server.Close()
	client, err := NewIdentitySessionHTTP(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if actor, err := client.ResolveCurrentSession(context.Background(), token); err != nil || actor.Subject != "merchant-one" {
		t.Fatalf("initial Identity principal: %+v err=%v", actor, err)
	}
	if actor, err := client.ResolveCurrentSession(context.Background(), token); !errors.Is(err, ErrUnauthorized) || actor.Subject != "" {
		t.Fatalf("revoked session remained usable: %+v err=%v", actor, err)
	}
	server.Close()
	if actor, err := client.ResolveCurrentSession(context.Background(), token); !errors.Is(err, ErrIdentityUnavailable) || actor.Subject != "" {
		t.Fatalf("Identity network failure reused previous actor: %+v err=%v", actor, err)
	}
}

type unavailableIdentitySession struct{}

func (unavailableIdentitySession) ResolveCurrentSession(context.Context, string) (VerifiedActor, error) {
	return VerifiedActor{}, ErrIdentityUnavailable
}
func (unavailableIdentitySession) RequireOperatorPermission(context.Context, string, string, string) error {
	return ErrIdentityUnavailable
}

func TestIdentityOutageCannotMutateStoreAndReturns503(t *testing.T) {
	count := 0
	svc, err := NewService(unavailableIdentitySession{}, fakeGrant{}, fakePolicy{}, fakeRepo{applies: &count})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = svc.Change(context.Background(), "token", validChange())
	if !errors.Is(err, ErrIdentityUnavailable) || count != 0 {
		t.Fatalf("Identity unavailable mutating Store: count=%d err=%v", count, err)
	}
	handler, _ := NewHandler(svc)
	request := httptest.NewRequest(http.MethodGet, "/v1/stores/store-one/availability", nil)
	request.Header.Set("Authorization", "Bearer opaque-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "IDENTITY_OWNER_UNAVAILABLE") {
		t.Fatalf("Identity outage not surfaced safely: %d %s", response.Code, response.Body.String())
	}
}
