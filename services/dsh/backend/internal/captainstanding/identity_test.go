package captainstanding

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCaptainStandingIdentityAdapterUsesCurrentOwnerSessionAndOperationsPermission(t *testing.T) {
	actorRole := "captain"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer real-opaque-token" || r.Header.Get("Cache-Control") != "no-store" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/sessions/current":
			fmt.Fprintf(w, `{"actorId":"actor-17","role":"%s","sessionExpiresAt":"%s"}`, actorRole, time.Now().UTC().Add(time.Minute).Format(time.RFC3339))
		case "/v1/operators/me/permissions/operations":
			fmt.Fprint(w, `{"actorId":"actor-17","permission":"operations"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	adapter, err := NewIdentityAdapter(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	actor, err := adapter.Resolve(context.Background(), "real-opaque-token")
	if err != nil || actor.ID != "actor-17" || actor.Role != "captain" {
		t.Fatalf("Identity role not verified: %+v %v", actor, err)
	}
	actorRole = "operator"
	if err = adapter.RequireOperations(context.Background(), "real-opaque-token", "actor-17"); err != nil {
		t.Fatalf("explicit operator operations permission denied: %v", err)
	}
	if err = adapter.RequireOperations(context.Background(), "real-opaque-token", "forged-id"); err == nil {
		t.Fatal("forged actor scope passed permission verification")
	}
	_, err = NewIdentityAdapter("http://public.example")
	if err == nil || !strings.Contains(err.Error(), "") {
		t.Fatal("public insecure Identity endpoint must be rejected")
	}
}
