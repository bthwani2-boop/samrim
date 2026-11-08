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
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
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
		case "test-partner-session-b":
			_, _ = w.Write([]byte(`{"subject":"actor-b","role":"partner","surface":"app-partner"}`))
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
		{"test-partner-session-b", true},
		{"test-revoked-session", false},
	} {
		t.Run(tc.token, func(t *testing.T) {
			// Exercise each private entry point through the real Identity client.
			// The deliberately absent database proves only that non-Partner
			// sessions are denied BEFORE persistence is touched.
			_, policyErr := service.ReadIndependentCustomerPolicyForOwner(context.Background(), tc.token, "store-a")
			_, previewErr := service.ReadIndependentPreview(context.Background(), tc.token, "store-a", 20, "")
			_, _, saveErr := service.SaveIndependentCustomerPolicyDraftForOwner(context.Background(), tc.token, "store-a",
				postgres.IndependentCustomerPolicyDraftInput{ExpectedVersion: 0,
					CancellationTerms: "Cancel with merchant", ReturnsTerms: "Return to merchant",
					FulfillmentTerms: "Collect at store", CollectionTerms: "Pay merchant"},
				"test-private-policy-idempotency-key", "test-private-policy-correlation")
			if !tc.allowed {
				for label, got := range map[string]error{"policy": policyErr, "preview": previewErr, "save": saveErr} {
					if tc.token == "test-revoked-session" {
						var identityErr *identityclient.Error
						if !errors.As(got, &identityErr) || identityErr.Status != http.StatusUnauthorized {
							t.Fatalf("%s revoked session did not fail at Identity boundary: %v", label, got)
						}
						continue
					}
					if !errors.Is(got, ErrPartnerSession) {
						t.Fatalf("%s non-Partner session reached Store storage: %v", label, got)
					}
				}
				return
			}
			// Both valid synthetic actors reach the owner-scoped SQL boundary;
			// no real A/B identity or persistent Store authorization is proven.
			if !errors.Is(policyErr, postgres.ErrStoreNotFound) ||
				!errors.Is(previewErr, postgres.ErrStoreNotFound) ||
				!errors.Is(saveErr, postgres.ErrIndependentCustomerPolicyInvalid) {
				t.Fatalf("Partner private Store boundary failed closed: policy=%v preview=%v save=%v",
					policyErr, previewErr, saveErr)
			}
		})
	}
}
