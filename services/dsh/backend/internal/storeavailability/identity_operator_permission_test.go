package storeavailability

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// These are consumer contract tests only. The actual Identity permission
// issuer and PostgreSQL grant are verified separately by their owner.
func TestOperatorRequiresCurrentIdentityPermissionOnEveryStoreChange(t *testing.T) {
	cases := []struct {
		name        string
		status      int
		body        string
		contentType string
		want        error
		allowed     bool
	}{
		{"accepted current grant", 200, `{"actorId":"operator-a","permission":"operations"}`, "application/json", nil, true},
		{"no operations grant", 403, `{"error":"FORBIDDEN"}`, "application/json", ErrForbidden, false},
		{"revoked after session verification", 401, `{"error":"UNAUTHORIZED"}`, "application/json", ErrUnauthorized, false},
		{"owner unavailable", 503, `{"error":"OWNER_UNAVAILABLE"}`, "application/json", ErrIdentityUnavailable, false},
		{"actor switched", 200, `{"actorId":"operator-b","permission":"operations"}`, "application/json", ErrForbidden, false},
		{"other grant", 200, `{"actorId":"operator-a","permission":"finance"}`, "application/json", ErrForbidden, false},
		{"unexpected field", 200, `{"actorId":"operator-a","permission":"operations","override":true}`, "application/json", ErrIdentityUnavailable, false},
		{"malformed", 200, `{"actorId":`, "application/json", ErrIdentityUnavailable, false},
		{"wrong content type", 200, `{"actorId":"operator-a","permission":"operations"}`, "text/plain", ErrIdentityUnavailable, false},
		{"oversized body", 200, strings.Repeat("x", 4097), "application/json", ErrIdentityUnavailable, false},
	}
	token := testOpaqueIdentityToken()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sessionReads, permissionReads := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+token ||
					r.Header.Get("Accept") != "application/json" || r.URL.RawQuery != "" {
					t.Errorf("untrusted Identity request: %s %s", r.Method, r.URL)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				switch r.URL.Path {
				case "/v1/sessions/current":
					sessionReads++
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{
						"actorId": "operator-a", "role": "operator",
						"sessionExpiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
					})
				case "/v1/operators/me/permissions/operations":
					permissionReads++
					w.Header().Set("Content-Type", tc.contentType)
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
				default:
					t.Errorf("unknown Identity path %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			identity, err := NewIdentitySessionHTTP(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			applies := 0
			service, err := NewService(identity, fakeGrant{}, fakePolicy{}, fakeRepo{applies: &applies})
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = service.Change(context.Background(), token, validChange())
			if tc.allowed {
				if err != nil || applies != 1 {
					t.Fatalf("valid granted Operator denied: error=%v applies=%d", err, applies)
				}
			} else if !errors.Is(err, tc.want) || applies != 0 {
				t.Fatalf("permission bypass or wrong failure: want=%v got=%v applies=%d", tc.want, err, applies)
			}
			if sessionReads != 1 || permissionReads != 1 {
				t.Fatalf("missing actual canonical Identity checks: sessions=%d permissions=%d", sessionReads, permissionReads)
			}
		})
	}
}

func TestOperatorPermissionRedirectNeverLeaksBearer(t *testing.T) {
	token := testOpaqueIdentityToken()
	var attackerSawBearer atomic.Bool
	attacker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			attackerSawBearer.Store(true)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer attacker.Close()
	identityOwner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/sessions/current":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"actorId": "operator-a", "role": "operator",
				"sessionExpiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			})
		case "/v1/operators/me/permissions/operations":
			http.Redirect(w, r, attacker.URL+"/exfiltrate", http.StatusTemporaryRedirect)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer identityOwner.Close()
	client, err := NewIdentitySessionHTTP(identityOwner.URL)
	if err != nil {
		t.Fatal(err)
	}
	writes := 0
	svc, err := NewService(client, fakeGrant{}, fakePolicy{}, fakeRepo{applies: &writes})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = svc.Change(context.Background(), token, validChange())
	if !errors.Is(err, ErrIdentityUnavailable) || writes != 0 || attackerSawBearer.Load() {
		t.Fatalf("redirect leaked bearer or mutated Store: error=%v writes=%d leaked=%t",
			err, writes, attackerSawBearer.Load())
	}
}

func TestOperatorPermissionRejectsUnrecognizedScopeWithoutOwnerCall(t *testing.T) {
	client, err := NewIdentitySessionHTTP("http://127.0.0.1:19999")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.RequireOperatorPermission(context.Background(), testOpaqueIdentityToken(), "operator-a", "finance"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unrecognized DSH permission admitted: %v", err)
	}
}

func TestIdentityHTTPPlatformPoliciesPermissionIsIndependentOfOperations(t *testing.T) {
	token := testOpaqueIdentityToken()
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"explicit active policy grant", http.StatusOK, `{"actorId":"operator-a","permission":"platform_policies"}`, nil},
		{"operations grant cannot substitute", http.StatusOK, `{"actorId":"operator-a","permission":"operations"}`, ErrForbidden},
		{"grant belongs to another actor", http.StatusOK, `{"actorId":"operator-b","permission":"platform_policies"}`, ErrForbidden},
		{"platform grant revoked", http.StatusForbidden, `{"error":"FORBIDDEN"}`, ErrForbidden},
		{"identity unavailable", http.StatusServiceUnavailable, `{"error":"OWNER_UNAVAILABLE"}`, ErrIdentityUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var policyReads atomic.Int32
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+token ||
					r.URL.RawQuery != "" || r.Header.Get("Accept") != identityJSONMediaType {
					t.Errorf("untrusted Identity request method=%s path=%s", r.Method, r.URL)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				w.Header().Set("Content-Type", identityJSONMediaType)
				switch r.URL.Path {
				case "/v1/sessions/current":
					_ = json.NewEncoder(w).Encode(map[string]any{
						"actorId": "operator-a", "role": "operator",
						"sessionExpiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
					})
				case "/v1/operators/me/permissions/platform_policies":
					policyReads.Add(1)
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
				case "/v1/operators/me/permissions/operations":
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`{"error":"FORBIDDEN"}`))
				default:
					t.Errorf("unapproved Identity path: %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer owner.Close()
			consumer, err := NewIdentitySessionHTTP(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			principal, err := consumer.ResolveCurrentSession(context.Background(), token)
			if err != nil || principal.Role != OperatorRole || principal.Subject != "operator-a" {
				t.Fatalf("unverified current session %+v %v", principal, err)
			}
			err = consumer.RequireOperatorPermission(context.Background(), token, principal.Subject, "platform_policies")
			if tc.want == nil && err != nil {
				t.Fatalf("explicit platform_policies permission denied: %v", err)
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("wanted %v got %v", tc.want, err)
			}
			if policyReads.Load() != 1 {
				t.Fatalf("did not query exact canonical Identity platform policy path: %d", policyReads.Load())
			}
			if err = consumer.RequireOperatorPermission(context.Background(), token, principal.Subject, "operations"); !errors.Is(err, ErrForbidden) {
				t.Fatalf("platform policy permission leaked into operations: %v", err)
			}
		})
	}
}

func TestIdentityHTTPRejectsUnapprovedPolicyPermissionStringsBeforeNetwork(t *testing.T) {
	consumer, err := NewIdentitySessionHTTP("http://127.0.0.1:19999")
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range []string{"", "finance", "platform_policies/operations", "PLATFORM_POLICIES", "platform_policies?admin=true", "operations/../platform_policies"} {
		if err := consumer.RequireOperatorPermission(context.Background(), testOpaqueIdentityToken(), "operator-a", scope); !errors.Is(err, ErrForbidden) {
			t.Fatalf("unapproved scope %q accepted: %v", scope, err)
		}
	}
}
