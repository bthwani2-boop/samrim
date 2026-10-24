package transporthttp

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
)

// Public or Operator credentials cannot use Store-scoped Partner reel APIs.
// The denial happens before database or media-storage access.
func TestPartnerReelRoutesRejectMissingPartnerSessionAndLegacyActorAuthority(t *testing.T) {
	const identityServiceToken = "identity-service-token-valid"
	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"UNAUTHENTICATED"}}`))
	}))
	defer denied.Close()
	endpoint, err := identityintegration.ResolveBaseURL(denied.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	identityClient, err := identityintegration.New(endpoint, identityServiceToken)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewMarketingWithDependencies(identityClient, "operator-service-token-123", db, nil)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, method := range []string{"GET", "POST"} {
		t.Run(method+" missing session", func(t *testing.T) {
			r := httptest.NewRequest(method, "/dsh/partner/stores/store-A/discovery-content", nil)
			if method == "POST" {
				r.Header.Set("Idempotency-Key", "partner-reel-create-001")
				r.Header.Set("X-Correlation-ID", "partner-reel-request-001")
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, r)
			if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
				t.Fatalf("route accepted missing Partner session: %d %s", response.Code, response.Body.String())
			}
		})
	}
	for _, oldHeader := range []string{"X-Actor-ID", "X-Acting-Actor-ID", "X-Expected-Version"} {
		t.Run("reject "+oldHeader, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/dsh/partner/stores/store-B/discovery-content", nil)
			r.Header.Set("Idempotency-Key", "partner-reel-create-002")
			r.Header.Set("X-Correlation-ID", "partner-reel-request-002")
			r.Header.Set(oldHeader, "forged-actor")
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, r)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("legacy client authority header allowed: %s -> %d %s", oldHeader, response.Code, response.Body.String())
			}
		})
	}
}
