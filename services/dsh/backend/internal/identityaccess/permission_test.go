package identityaccess

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

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
				w.Header().Set("Cache-Control", "no-store")
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

func TestIdentityHTTPRejectsMalformedActorBeforePermissionOwnerCall(t *testing.T) {
	consumer, err := NewIdentitySessionHTTP("http://127.0.0.1:19999")
	if err != nil {
		t.Fatal(err)
	}
	for _, actorID := range []string{"operator-a\x00other", "operator-a\x7fother", "operator-a\u0085other", "operator-a\xffother"} {
		if err := consumer.RequireOperatorPermission(t.Context(), testOpaqueIdentityToken(), actorID, "hr"); !errors.Is(err, ErrForbidden) {
			t.Fatalf("malformed Identity actor reached the permission owner: %v", err)
		}
	}
}
