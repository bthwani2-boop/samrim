package storeaccess

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Exercise the canonical Identity client against a disposable in-memory HTTP
// service. These are session/role gates, not a substitute for PostgreSQL IDOR
// or an authenticated public Store journey.
func TestIndependentCustomerPolicyRequiresCurrentPartnerSurface(t *testing.T) {
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("unexpected Identity method %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		switch strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") {
		case "test-client-session":
			_, _ = w.Write([]byte(`{"subject":"actor-a","role":"client","surface":"app-client"}`))
		case "test-captain-session":
			_, _ = w.Write([]byte(`{"subject":"actor-a","role":"captain","surface":"app-captain"}`))
		case "test-mismatched-surface":
			_, _ = w.Write([]byte(`{"subject":"actor-a","role":"partner","surface":"app-client"}`))
		case "test-empty-actor":
			_, _ = w.Write([]byte(`{"subject":"","role":"partner","surface":"app-partner"}`))
		case "test-partner-session":
			_, _ = w.Write([]byte(`{"subject":"actor-a","role":"partner","surface":"app-partner"}`))
		default:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"UNAUTHENTICATED"}}`))
		}
	}))
	defer identityServer.Close()
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	client, err := identityintegration.New(endpoint, "test-service-token-for-identity-reads")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{identity: client}
	for _, tc := range []struct {
		token   string
		allowed bool
	}{
		{"test-client-session", false},
		{"test-captain-session", false},
		{"test-mismatched-surface", false},
		{"test-empty-actor", false},
		{"test-partner-session", true},
	} {
		t.Run(tc.token, func(t *testing.T) {
			_, err := service.ReadIndependentCustomerPolicyForOwner(context.Background(), tc.token, "store-a")
			if !tc.allowed {
				if !errors.Is(err, ErrPartnerSession) {
					t.Fatalf("non-Partner session reached Store storage: %v", err)
				}
				return
			}
			// With a verified Partner actor the intentionally absent DB
			// must fail closed at the existing owned-Store SQL boundary.
			if !errors.Is(err, postgres.ErrStoreNotFound) {
				t.Fatalf("verified Partner did not reach canonical owner guard: %v", err)
			}
		})
	}
}
