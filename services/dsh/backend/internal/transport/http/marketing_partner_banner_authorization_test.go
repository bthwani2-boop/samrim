package transporthttp

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPartnerBannerListRejectsUnverifiedSession(t *testing.T) {
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
	client, err := identityintegration.New(endpoint, "identity-service-token-valid")
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewMarketingWithDependencies(client, "operator-service-token-123", db, nil)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, path := range []string{
		"/dsh/partner/stores/store-A/banners",
		"/dsh/partner/stores/store-B/banners",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
			t.Fatalf("%s returned %d %s, expected 401", path, response.Code, response.Body.String())
		}
	}
	for _, storeID := range []string{"store-A", "store-B"} {
		req := httptest.NewRequest(http.MethodPost, "/dsh/partner/stores/"+storeID+"/banners/banner-X/visibility", strings.NewReader(`{"enabled":false,"expectedVersion":1}`))
		req.Header.Set("X-Correlation-ID", "store-banner-test-001")
		req.Header.Set("Idempotency-Key", "store-banner-visibility-test-001")
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
			t.Fatalf("visibility mutation on %s returned %d %s, expected 401", storeID, response.Code, response.Body.String())
		}
	}
	for _, route := range []string{"/dsh/public/stores/store-A/banners", "/dsh/public/stores/store-B/banners"} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
			t.Fatalf("missing Service City on %s returned %d %s, expected 400", route, response.Code, response.Body.String())
		}
	}
}

func TestDiscoveryContentUploadIdempotencyIsStoreScoped(t *testing.T) {
	// Same content and actor, but a different authorized Store, is a
	// conflicting replay rather than the original Store's media mutation.
	facts := []string{"discovery-content-create", "content-1", "BANNER", "owned-image-digest", "actor-multiple-stores"}
	storeA := hashDiscoveryContentUploadRequest("store-A", facts...)
	if storeA != hashDiscoveryContentUploadRequest("store-A", facts...) {
		t.Fatal("same Store and facts must preserve the retry hash")
	}
	if storeA == hashDiscoveryContentUploadRequest("store-B", facts...) {
		t.Fatal("cross-Store replay reused an upload request hash")
	}
	if storeA == hashDiscoveryContentUploadRequest("", facts...) {
		t.Fatal("Partner Store upload must not replay as operator content")
	}
	if len(facts) != 5 {
		t.Fatal("hash helper unexpectedly mutated its source facts")
	}
}

func TestLegacyPartnerUploadReplayRequiresSameStoreActorAndActiveMedia(t *testing.T) {
	legacy := postgres.DiscoveryContentRecord{SourceStoreID: "store-A", CreatedByActorID: "actor-A", MediaURI: "https://media.test/banner-A.png"}
	if !eligibleLegacyPartnerUploadReplay(legacy, "store-A", "actor-A", legacy.MediaURI) {
		t.Fatal("the same completed legacy mutation must be safely replayable")
	}
	for _, tc := range []struct {
		name, store, actor, mediaURI string
	}{
		{"foreign Store", "store-B", "actor-A", legacy.MediaURI},
		{"foreign actor", "store-A", "actor-B", legacy.MediaURI},
		{"different media", "store-A", "actor-A", "https://media.test/banner-B.png"},
		{"empty media", "store-A", "actor-A", ""},
		{"empty Store", "", "actor-A", legacy.MediaURI},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if eligibleLegacyPartnerUploadReplay(legacy, tc.store, tc.actor, tc.mediaURI) {
				t.Fatal("unauthorized legacy upload replay was accepted")
			}
		})
	}
}
