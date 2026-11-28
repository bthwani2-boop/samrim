package captainstanding

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	adapterTestToken      = "synthetic-opaque-token"
	adapterTestActor      = "actor-17"
	adapterSessionPath    = "/v1/sessions/current"
	adapterPermissionPath = "/v1/operators/me/permissions/operations"
)

func adapterSessionBody(role string, expiry time.Time) string {
	return fmt.Sprintf(`{"actorId":%q,"role":%q,"sessionExpiresAt":%q}`, adapterTestActor, role, expiry.UTC().Format(time.RFC3339Nano))
}

func adapterOwner(t *testing.T, endpoint string, reply func(http.ResponseWriter)) *IdentityAdapter {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != endpoint || r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer "+adapterTestToken ||
			r.Header.Get("Cache-Control") != "no-store" || r.Header.Get("Accept") != "application/json" {
			t.Errorf("unexpected owner request: method=%s path=%s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		reply(w)
	}))
	t.Cleanup(server.Close)
	adapter, err := NewIdentityAdapter(server.URL)
	if err != nil || adapter == nil {
		t.Fatalf("valid loopback owner not admitted: %v", err)
	}
	return adapter
}

func TestCaptainStandingIdentityAdapterOriginAdmission(t *testing.T) {
	for _, origin := range []string{
		"", "not-an-origin", "http://public.example", "ftp://127.0.0.1",
		"http://user@127.0.0.1", "http://127.0.0.1/path", "http://127.0.0.1?query",
		"http://127.0.0.1#fragment",
	} {
		t.Run(origin, func(t *testing.T) {
			adapter, err := NewIdentityAdapter(origin)
			if adapter != nil || !errors.Is(err, ErrInvalidChange) {
				t.Fatalf("invalid origin must return INVALID_REQUEST, got adapter=%v err=%v", adapter != nil, err)
			}
		})
	}
	for _, origin := range []string{"http://127.0.0.1:1234", "http://localhost:1234/", "https://identity.example"} {
		t.Run(origin, func(t *testing.T) {
			adapter, err := NewIdentityAdapter(origin)
			if adapter == nil || err != nil {
				t.Fatalf("valid owner origin rejected: %v", err)
			}
		})
	}
}

func TestCaptainStandingIdentityAdapterCurrentRole(t *testing.T) {
	for _, role := range []string{"customer", "merchant", "captain", "operator"} {
		t.Run(role, func(t *testing.T) {
			adapter := adapterOwner(t, adapterSessionPath, func(w http.ResponseWriter) {
				fmt.Fprint(w, adapterSessionBody(role, time.Now().Add(time.Minute)))
			})
			actor, err := adapter.Resolve(t.Context(), adapterTestToken)
			if err != nil || actor != (Actor{ID: adapterTestActor, Role: role}) {
				t.Fatalf("canonical Identity role/actor not preserved: %+v %v", actor, err)
			}
		})
	}
}

func TestCaptainStandingIdentityAdapterSessionFailureAndRecovery(t *testing.T) {
	valid := adapterSessionBody("captain", time.Now().Add(time.Hour))
	cases := []struct {
		name   string
		status int
		body   string
		cache  string
		want   error
	}{
		{"revoked", 401, "", "no-store", ErrUnauthorized},
		{"unexpected forbidden", 403, "", "no-store", ErrOwnerUnavailable},
		{"owner unavailable", 503, "", "no-store", ErrOwnerUnavailable},
		{"redirect", 302, "", "no-store", ErrOwnerUnavailable},
		{"invalid JSON", 200, "{", "no-store", ErrOwnerUnavailable},
		{"cached session", 200, valid, "public", ErrOwnerUnavailable},
		{"expired session", 200, adapterSessionBody("captain", time.Now().Add(-time.Hour)), "no-store", ErrUnauthorized},
		{"unknown role", 200, adapterSessionBody("unknown", time.Now().Add(time.Hour)), "no-store", ErrUnauthorized},
		{"oversized body", 200, strings.Repeat(" ", 4097), "no-store", ErrOwnerUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			adapter := adapterOwner(t, adapterSessionPath, func(w http.ResponseWriter) {
				if calls.Add(1) == 2 {
					w.Header().Set("Cache-Control", tc.cache)
					w.WriteHeader(tc.status)
					fmt.Fprint(w, tc.body)
					return
				}
				fmt.Fprint(w, valid)
			})
			wantActor := Actor{ID: adapterTestActor, Role: "captain"}
			for index := 0; index < 3; index++ {
				actor, err := adapter.Resolve(t.Context(), adapterTestToken)
				if index == 1 {
					if actor != (Actor{}) || !errors.Is(err, tc.want) {
						t.Fatalf("failed owner response must not reuse prior actor: %+v %v, want %v", actor, err, tc.want)
					}
				} else if actor != wantActor || err != nil {
					t.Fatalf("current owner session not recovered: %+v %v", actor, err)
				}
			}
			if got := calls.Load(); got != 3 {
				t.Fatalf("each decision must read the owner, got %d requests", got)
			}
		})
	}
}

func TestCaptainStandingIdentityAdapterOperationsPermission(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		actor  string
		want   error
	}{
		{"exact grant", 200, `{"actorId":"actor-17","permission":"operations"}`, adapterTestActor, nil},
		{"wrong actor", 200, `{"actorId":"actor-17","permission":"operations"}`, "other-actor", ErrForbidden},
		{"wrong scope", 200, `{"actorId":"actor-17","permission":"finance"}`, adapterTestActor, ErrForbidden},
		{"revoked session", 401, "", adapterTestActor, ErrUnauthorized},
		{"permission denied", 403, "", adapterTestActor, ErrForbidden},
		{"owner unavailable", 503, "", adapterTestActor, ErrOwnerUnavailable},
		{"malformed grant", 200, `{"actorId":"actor-17"}`, adapterTestActor, ErrOwnerUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			adapter := adapterOwner(t, adapterPermissionPath, func(w http.ResponseWriter) {
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			})
			err := adapter.RequireOperations(t.Context(), adapterTestToken, tc.actor)
			if !errors.Is(err, tc.want) {
				t.Fatalf("permission decision = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestCaptainStandingIdentityAdapterUnavailableClientAndInvalidInputs(t *testing.T) {
	for _, adapter := range []*IdentityAdapter{nil, {}} {
		actor, err := adapter.Resolve(t.Context(), adapterTestToken)
		if actor != (Actor{}) || !errors.Is(err, ErrOwnerUnavailable) {
			t.Fatalf("unavailable adapter returned %+v %v", actor, err)
		}
		if err := adapter.RequireOperations(t.Context(), adapterTestToken, adapterTestActor); !errors.Is(err, ErrOwnerUnavailable) {
			t.Fatalf("unavailable permission adapter returned %v", err)
		}
	}
	adapter := adapterOwner(t, adapterSessionPath, func(w http.ResponseWriter) {
		t.Error("invalid credentials or actor ID reached owner")
		w.WriteHeader(http.StatusInternalServerError)
	})
	for _, token := range []string{"", "embedded space", "\ninvalid"} {
		actor, err := adapter.Resolve(t.Context(), token)
		if actor != (Actor{}) || !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("invalid token returned %+v %v", actor, err)
		}
		if err := adapter.RequireOperations(t.Context(), token, adapterTestActor); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("invalid permission token returned %v", err)
		}
	}
	for _, id := range []string{"", " leading", "actor\x00id"} {
		if err := adapter.RequireOperations(t.Context(), adapterTestToken, id); !errors.Is(err, ErrForbidden) {
			t.Fatalf("invalid permission subject returned %v", err)
		}
	}
}
