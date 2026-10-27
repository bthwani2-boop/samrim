package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

// Validate actor-level HTTP order visibility against real SQL ownership rules.
// No WLT money is mutated; the payment dependency must not be contacted for reads.
func TestOrderHTTPRejectsAuthenticatedCrossActorReads(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const clientA = "orders-http-client-a"
		const clientB = "orders-http-client-b"
		const partnerA = "orders-http-partner-a"
		const partnerB = "orders-http-partner-b"
		const store = "orders-http-store-a"
		const order = "orders-http-order-a"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('orders-http-city','مدينة الاختبار',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: partnerA, Name: "Orders HTTP Store", ServiceCityID: "orders-http-city"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('orders-http-cart',$1,$2,'checked_out',1)", clientA, store); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
		 (id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
		  service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,
		  serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,
		  payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
		 VALUES($1,$2,$3,'orders-http-cart','orders-http-address',1,'Proof address',15.3694457,44.1910064,
		  'orders-http-city','CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,'orders-http-payment',
		  'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, order, clientA, store); err != nil {
			t.Fatal(err)
		}
		identities := map[string]struct{ subject, role, surface string }{
			"orders-token-client-a":  {clientA, "client", "app-client"},
			"orders-token-client-b":  {clientB, "client", "app-client"},
			"orders-token-partner-a": {partnerA, "partner", "app-partner"},
			"orders-token-partner-b": {partnerB, "partner", "app-partner"},
		}
		idServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/auth/session" {
				http.NotFound(w, r)
				return
			}
			actor, ok := identities[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
			if !ok {
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
		defer idServer.Close()
		endpoint, err := identityintegration.ResolveBaseURL(idServer.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identity, err := identityintegration.New(endpoint, strings.Repeat("i", 32))
		if err != nil {
			t.Fatal(err)
		}
		unexpectedPayment := 0
		wltServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			unexpectedPayment++
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer wltServer.Close()
		payment, err := wltintegration.New(wltServer.URL, "test", strings.Repeat("w", 32))
		if err != nil {
			t.Fatal(err)
		}
		server, err := transporthttp.NewOrder(identity, strings.Repeat("s", 32), db, payment, testDeliveryProofKeyring(t))
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		server.Register(mux)
		call := func(token, method, path, forgedID string, status int) *httptest.ResponseRecorder {
			t.Helper()
			req := httptest.NewRequest(method, path, nil)
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			if forgedID != "" {
				req.Header.Set("X-Actor-ID", forgedID)
				req.Header.Set("X-Acting-Actor-ID", forgedID)
			}
			result := httptest.NewRecorder()
			mux.ServeHTTP(result, req)
			if result.Code != status {
				t.Fatalf("%s %s as %s returned %d want %d: %s", method, path, token, result.Code, status, result.Body.String())
			}
			return result
		}
		path := "/dsh/orders/" + order
		owned := call("orders-token-client-a", http.MethodGet, path, "", http.StatusOK)
		if !strings.Contains(owned.Body.String(), order) {
			t.Fatalf("owner cannot read own order: %s", owned.Body.String())
		}
		call("orders-token-client-b", http.MethodGet, path, "", http.StatusNotFound)
		call("orders-token-client-b", http.MethodGet, path, clientA, http.StatusNotFound)
		call("orders-token-partner-a", http.MethodGet, path, "", http.StatusOK)
		call("orders-token-partner-b", http.MethodGet, path, partnerA, http.StatusForbidden)
		call("", http.MethodGet, path, clientA, http.StatusUnauthorized)
		// A Client who owns this Order still cannot use the Partner-only Store route.
		storePath := "/dsh/stores/" + store + "/orders/" + order
		storeOwned := call("orders-token-partner-a", http.MethodGet, storePath, "", http.StatusOK)
		if !strings.Contains(storeOwned.Body.String(), order) {
			t.Fatalf("authorized Partner cannot read its Store Order: %s", storeOwned.Body.String())
		}
		call("orders-token-client-a", http.MethodGet, storePath, "", http.StatusForbidden)
		call("orders-token-client-b", http.MethodGet, storePath, "", http.StatusNotFound)
		call("orders-token-partner-b", http.MethodGet, storePath, "", http.StatusForbidden)
		call("orders-token-partner-a", http.MethodGet, "/dsh/stores/other-store/orders/"+order, "", http.StatusForbidden)
		call("", http.MethodGet, storePath, "", http.StatusUnauthorized)
		listA := call("orders-token-client-a", http.MethodGet, "/dsh/orders", "", http.StatusOK)
		listB := call("orders-token-client-b", http.MethodGet, "/dsh/orders", clientA, http.StatusOK)
		if !strings.Contains(listA.Body.String(), order) || strings.Contains(listB.Body.String(), order) {
			t.Fatal("client order list leaked across actor boundary")
		}
		if unexpectedPayment != 0 {
			t.Fatalf("read-only HTTP owner checks sent %d unexpected calls to WLT", unexpectedPayment)
		}
	})
}
