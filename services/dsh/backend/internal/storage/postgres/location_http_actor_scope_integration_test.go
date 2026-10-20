package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

// Exercise the real location HTTP handlers, canonical Identity session lookup,
// and PostgreSQL owner predicates with two distinct authenticated accounts.
// The test owns a fresh database and cannot use the regular runtime database.
func TestLocationHTTPRejectsAuthenticatedCrossActorAddressAndStoreAccess(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })

	withFreshDatabase(t, root, rootURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('http-scope-city','Proof city',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "http-scope-store-a", PartnerActorID: "http-scope-partner-a", Name: "Proof Store A", ServiceCityID: "http-scope-city"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "http-scope-store-b", PartnerActorID: "http-scope-partner-b", Name: "Proof Store B", ServiceCityID: "http-scope-city"})

		identities := map[string]struct{ subject, role, surface string }{
			"proof-client-token-a":  {"http-scope-client-a", "client", "app-client"},
			"proof-client-token-b":  {"http-scope-client-b", "client", "app-client"},
			"proof-partner-token-a": {"http-scope-partner-a", "partner", "app-partner"},
			"proof-partner-token-b": {"http-scope-partner-b", "partner", "app-partner"},
		}
		identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/auth/session" {
				http.NotFound(w, r)
				return
			}
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			actor, valid := identities[token]
			if !valid {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"UNAUTHENTICATED"}}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subject": actor.subject, "role": actor.role, "surface": actor.surface,
				"expiresAt": time.Now().Add(time.Hour).UTC(),
			})
		}))
		defer identityServer.Close()
		endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identity, err := identityintegration.New(endpoint, strings.Repeat("i", 32))
		if err != nil {
			t.Fatal(err)
		}
		server, err := transporthttp.NewLocationCore(identity, db)
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		server.Register(mux)
		call := func(token, method, url, payload string, headers map[string]string, status int) *httptest.ResponseRecorder {
			t.Helper()
			req := httptest.NewRequest(method, url, strings.NewReader(payload))
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			req.Header.Set("Content-Type", "application/json")
			for key, value := range headers {
				req.Header.Set(key, value)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, req)
			if response.Code != status {
				t.Fatalf("%s %s token=%s status=%d expected=%d body=%s", method, url, token, response.Code, status, response.Body.String())
			}
			return response
		}
		correlation := map[string]string{"X-Correlation-ID": "http-scope-create-a", "Idempotency-Key": "http-scope-create-a"}
		created := call("proof-client-token-a", http.MethodPost, "/dsh/addresses",
			`{"addressText":"Proof client A address","latitude":15.3694,"longitude":44.1910,"serviceCityId":"http-scope-city"}`,
			correlation, http.StatusCreated)
		var createdAddress struct {
			Address struct {
				ID          string `json:"id"`
				AddressText string `json:"addressText"`
				Version     int    `json:"version"`
			} `json:"address"`
		}
		if err := json.Unmarshal(created.Body.Bytes(), &createdAddress); err != nil {
			t.Fatal(err)
		}
		if createdAddress.Address.ID == "" || createdAddress.Address.Version != 1 {
			t.Fatalf("address creation readback invalid: %s", created.Body.String())
		}
		addressPath := "/dsh/addresses/" + createdAddress.Address.ID
		call("proof-client-token-a", http.MethodGet, addressPath, "", nil, http.StatusOK)
		call("proof-client-token-b", http.MethodGet, addressPath, "", nil, http.StatusNotFound)
		call("proof-client-token-b", http.MethodGet, addressPath, "", map[string]string{"X-Actor-ID": "http-scope-client-a", "X-Acting-Actor-ID": "http-scope-client-a"}, http.StatusNotFound)
		call("proof-partner-token-a", http.MethodGet, addressPath, "", nil, http.StatusForbidden)
		call("", http.MethodGet, addressPath, "", nil, http.StatusUnauthorized)
		own := call("proof-client-token-a", http.MethodGet, "/dsh/addresses", "", nil, http.StatusOK)
		foreign := call("proof-client-token-b", http.MethodGet, "/dsh/addresses", "", nil, http.StatusOK)
		if !strings.Contains(own.Body.String(), createdAddress.Address.ID) || strings.Contains(foreign.Body.String(), createdAddress.Address.ID) {
			t.Fatal("client B could see client A address in list")
		}
		version := fmt.Sprint(createdAddress.Address.Version)
		updateHeaders := map[string]string{
			"X-Correlation-ID": "http-scope-update-b", "Idempotency-Key": "http-scope-update-b",
			"X-Expected-Version": version,
		}
		call("proof-client-token-b", http.MethodPost, addressPath,
			`{"addressText":"Foreign attempt","latitude":15.3694,"longitude":44.1910,"serviceCityId":"http-scope-city"}`,
			updateHeaders, http.StatusNotFound)
		unchanged, err := postgres.ReadDeliveryAddress(ctx, db, createdAddress.Address.ID, "http-scope-client-a")
		if err != nil || unchanged.AddressText != createdAddress.Address.AddressText || unchanged.Version != 1 {
			t.Fatalf("foreign mutation changed persisted record: %+v %v", unchanged, err)
		}
		call("proof-partner-token-a", http.MethodGet, "/dsh/stores/http-scope-store-a/delivery-origin", "", nil, http.StatusOK)
		call("proof-partner-token-b", http.MethodGet, "/dsh/stores/http-scope-store-a/delivery-origin", "", nil, http.StatusNotFound)
		call("proof-partner-token-a", http.MethodGet, "/dsh/stores/http-scope-store-b/delivery-origin", "", nil, http.StatusNotFound)
		call("proof-client-token-a", http.MethodGet, "/dsh/stores/http-scope-store-a/delivery-origin", "", nil, http.StatusForbidden)
	})
}
