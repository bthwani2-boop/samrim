package identityaccess

import (
	"bytes"
	"compress/gzip"
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
		w.Header().Set("Cache-Control", "no-store")
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
		{"duplicate actor", 200, `{"actorId":"other","actorId":"merchant-one","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrIdentityUnavailable},
		{"case variant role", 200, `{"actorId":"merchant-one","Role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrIdentityUnavailable},
		{"duplicate role", 200, `{"actorId":"merchant-one","role":"customer","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrIdentityUnavailable},
		{"null actor", 200, `{"actorId":null,"role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrIdentityUnavailable},
		{"missing actor", 200, `{"role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrIdentityUnavailable},
		{"unknown field", 200, `{"actorId":"merchant-one","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z","admin":true}`, ErrIdentityUnavailable},
		{"empty actor", 200, `{"actorId":"","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"NUL actor", 200, `{"actorId":"merchant-\u0000","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"DEL actor", 200, `{"actorId":"merchant-\u007f","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"Unicode control actor", 200, `{"actorId":"merchant-\u0085other","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, ErrUnauthorized},
		{"invalid UTF-8 owner bytes", 200, "{\"actorId\":\"merchant-\xff\",\"role\":\"merchant\",\"sessionExpiresAt\":\"2099-01-01T00:00:00Z\"}", ErrIdentityUnavailable},
		{"bad JSON", 200, `{"actorId":`, ErrIdentityUnavailable},
		{"oversized", 200, strings.Repeat("x", 4097), ErrIdentityUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
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

func TestIdentityHTTPRequiresUncachedOwnerEvidence(t *testing.T) {
	for _, cache := range [][]string{nil, {"max-age=60"}, {"no-store", "public"}} {
		t.Run(strings.Join(cache, ","), func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				for _, value := range cache {
					w.Header().Add("Cache-Control", value)
				}
				if r.URL.Path == "/v1/sessions/current" {
					_, _ = w.Write([]byte(`{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`))
					return
				}
				_, _ = w.Write([]byte(`{"actorId":"operator-a","permission":"operations"}`))
			}))
			defer owner.Close()
			client, err := NewIdentitySessionHTTP(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			token := testOpaqueIdentityToken()
			actor, err := client.ResolveCurrentSession(t.Context(), token)
			if !errors.Is(err, ErrIdentityUnavailable) || actor.Subject != "" {
				t.Errorf("unverified cache policy identified an actor: actor=%+v err=%v", actor, err)
			}
			if err = client.RequireOperatorPermission(t.Context(), token, "operator-a", "operations"); !errors.Is(err, ErrIdentityUnavailable) {
				t.Errorf("unverified cache policy granted an operation: %v", err)
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
		"http://127.0.0.1:3302?",
		"http://127.0.0.1:3302/%2F",
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
		w.Header().Set("Cache-Control", "no-store")
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

func TestIdentityHTTPMapsEveryCanonicalRole(t *testing.T) {
	for _, tc := range []struct {
		wire string
		want ActorRole
	}{
		{"merchant", MerchantRole},
		{"operator", OperatorRole},
		{"customer", CustomerRole},
		{"captain", CaptainRole},
	} {
		t.Run(tc.wire, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"actorId":          "actor-one",
					"role":             tc.wire,
					"sessionExpiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
				})
			}))
			defer owner.Close()
			consumer, err := NewIdentitySessionHTTP(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			actor, err := consumer.ResolveCurrentSession(t.Context(), testOpaqueIdentityToken())
			if err != nil || actor.Subject != "actor-one" || actor.Role != tc.want {
				t.Fatalf("role mapping failed: got %+v, err %v; wanted %s", actor, err, tc.want)
			}
		})
	}
}

func TestIdentityHTTPRejectsInvalidBearerAndUnavailableClient(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	client, err := NewIdentitySessionHTTP(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"", " leading", "a b", "a\tb", "a\rb", "a\nb"} {
		if actor, err := client.ResolveCurrentSession(t.Context(), token); actor.Subject != "" || !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("invalid session bearer admitted: %v", err)
		}
		if err := client.RequireOperatorPermission(t.Context(), token, "operator-a", "operations"); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("invalid permission bearer admitted: %v", err)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid bearer reached the owner")
	}
	var unavailable *IdentitySessionHTTP
	if _, err := unavailable.ResolveCurrentSession(t.Context(), testOpaqueIdentityToken()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("nil client session: %v", err)
	}
	if err := unavailable.RequireOperatorPermission(t.Context(), testOpaqueIdentityToken(), "operator-a", "operations"); !errors.Is(err, ErrIdentityUnavailable) {
		t.Fatalf("nil client permission: %v", err)
	}
}

func TestIdentityHTTPRejectsNoncanonicalOwnerWire(t *testing.T) {
	for _, tc := range []struct {
		name, media, body string
		status            int
	}{
		{"wrong media", "text/plain", `{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200},
		{"forbidden session", "application/json", `{"error":"FORBIDDEN"}`, 403},
		{"unpaired surrogate", "application/json", `{"actorId":"operator-\ud800","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200},
		{"escaped duplicate", "application/json", `{"actorId":"other","actor\u0049d":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200},
		{"trailing value", "application/json", `{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}{}`, 200},
		{"null principal", "application/json", "null", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.media)
				w.Header().Set("Cache-Control", "no-store")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer owner.Close()
			client, err := NewIdentitySessionHTTP(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			if actor, err := client.ResolveCurrentSession(t.Context(), testOpaqueIdentityToken()); actor.Subject != "" || !errors.Is(err, ErrIdentityUnavailable) {
				t.Fatalf("noncanonical wire admitted: %+v %v", actor, err)
			}
		})
	}
}

func TestIdentityHTTPAdmitsOnlyUnambiguousOwnerRepresentations(t *testing.T) {
	for _, tc := range []struct {
		name     string
		media    []string
		cache    []string
		encoding string
		trailer  string
		want     error
	}{
		{"canonical", []string{"application/json"}, []string{"no-store"}, "", "", nil},
		{"owner UTF-8", []string{"application/json; charset=utf-8"}, []string{"no-store"}, "", "", nil},
		{"identical media", []string{"application/json", "application/json"}, []string{"no-store"}, "", "", ErrIdentityUnavailable},
		{"conflicting media", []string{"application/json", "text/html"}, []string{"no-store"}, "", "", ErrIdentityUnavailable},
		{"invalid charset", []string{"application/json; charset=iso-8859-1"}, []string{"no-store"}, "", "", ErrIdentityUnavailable},
		{"unknown parameter", []string{"application/json; profile=unknown"}, []string{"no-store"}, "", "", ErrIdentityUnavailable},
		{"duplicate cache", []string{"application/json"}, []string{"no-store", "no-store"}, "", "", ErrIdentityUnavailable},
		{"encoded JSON", []string{"application/json"}, []string{"no-store"}, "gzip", "", ErrIdentityUnavailable},
		{"media trailer", []string{"application/json"}, []string{"no-store"}, "", "Content-Type", ErrIdentityUnavailable},
		{"cache trailer", []string{"application/json"}, []string{"no-store"}, "", "Cache-Control", ErrIdentityUnavailable},
		{"encoding trailer", []string{"application/json"}, []string{"no-store"}, "", "Content-Encoding", ErrIdentityUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Accept-Encoding") != "identity" {
					t.Errorf("owner request did not negotiate identity encoding")
				}
				for _, value := range tc.media {
					w.Header().Add("Content-Type", value)
				}
				for _, value := range tc.cache {
					w.Header().Add("Cache-Control", value)
				}
				if tc.encoding != "" {
					w.Header().Set("Content-Encoding", tc.encoding)
				}
				if tc.trailer != "" {
					w.Header().Set("Trailer", tc.trailer)
				}
				var body string
				switch r.URL.Path {
				case "/v1/sessions/current":
					body = `{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
				case "/v1/operators/me/permissions/operations":
					body = `{"actorId":"operator-a","permission":"operations"}`
				default:
					t.Errorf("unexpected owner route %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				if tc.encoding == "gzip" {
					writer := gzip.NewWriter(w)
					_, _ = writer.Write([]byte(body))
					_ = writer.Close()
				} else {
					_, _ = w.Write([]byte(body))
				}
				if tc.trailer != "" {
					w.Header().Set(tc.trailer, "unexpected")
				}
			}))
			defer owner.Close()
			client, err := NewIdentitySessionHTTP(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			actor, err := client.ResolveCurrentSession(context.Background(), testOpaqueIdentityToken())
			if !errors.Is(err, tc.want) {
				t.Fatalf("session error=%v, want %v", err, tc.want)
			}
			if tc.want == nil && (actor.Subject != "operator-a" || actor.Role != OperatorRole) {
				t.Fatalf("canonical session was not resolved: %+v", actor)
			}
			if tc.want != nil && actor != (VerifiedActor{}) {
				t.Fatalf("rejected representation returned an actor: %+v", actor)
			}
			if err := client.RequireOperatorPermission(context.Background(), testOpaqueIdentityToken(), "operator-a", "operations"); !errors.Is(err, tc.want) {
				t.Fatalf("grant error=%v, want %v", err, tc.want)
			}
		})
	}
}
