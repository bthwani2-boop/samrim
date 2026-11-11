package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

// Validate actor-level HTTP order scope and partner transition retries against real SQL ownership rules.
// No WLT money is mutated; reads and Partner acceptance must not contact the payment dependency.
func TestOrderHTTPActorScopeAndPartnerTransitionRetry(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const clientA = "orders-http-client-a"
		const clientB = "orders-http-client-b"
		const partnerA = "orders-http-partner-a"
		const partnerB = "orders-http-partner-b"
		const store = "orders-http-store-a"
		const otherStore = "orders-http-store-a-other"
		const order = "orders-http-order-a"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('orders-http-city','مدينة الاختبار',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: partnerA, Name: "Orders HTTP Store", ServiceCityID: "orders-http-city"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: otherStore, PartnerActorID: partnerA, Name: "Orders HTTP Other Store", ServiceCityID: "orders-http-city"})
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
		transition := func(storeID, state, key string, version, status int) *httptest.ResponseRecorder {
			t.Helper()
			path := "/dsh/stores/" + storeID + "/orders/" + order + "/transition"
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"state":"`+state+`"}`))
			req.Header.Set("Authorization", "Bearer orders-token-partner-a")
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", key)
			req.Header.Set("X-Correlation-ID", "orders-http-transition-correlation")
			req.Header.Set("X-Expected-Version", strconv.Itoa(version))
			result := httptest.NewRecorder()
			mux.ServeHTTP(result, req)
			if result.Code != status {
				t.Fatalf("POST %s as Partner returned %d want %d: %s", path, result.Code, status, result.Body.String())
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
		if strings.Contains(storeOwned.Body.String(), "Proof address") {
			t.Fatal("authorized Partner Store order response exposed the Client delivery address")
		}
		assertNoPrivateOrderData := func(actor string, response *httptest.ResponseRecorder) {
			t.Helper()
			for _, privateValue := range []string{order, "Proof address", "orders-http-payment"} {
				if strings.Contains(response.Body.String(), privateValue) {
					t.Errorf("denied Store order response for %s leaked private order data %q: %s", actor, privateValue, response.Body.String())
				}
			}
		}
		clientDenied := call("orders-token-client-a", http.MethodGet, storePath, "", http.StatusForbidden)
		assertNoPrivateOrderData("owning Client", clientDenied)
		call("orders-token-client-b", http.MethodGet, storePath, "", http.StatusNotFound)
		unrelatedPartnerDenied := call("orders-token-partner-b", http.MethodGet, storePath, "", http.StatusForbidden)
		assertNoPrivateOrderData("unrelated Partner", unrelatedPartnerDenied)
		wrongStoreDenied := call("orders-token-partner-a", http.MethodGet, "/dsh/stores/other-store/orders/"+order, "", http.StatusForbidden)
		assertNoPrivateOrderData("Partner using a non-matching Store", wrongStoreDenied)
		call("", http.MethodGet, storePath, "", http.StatusUnauthorized)
		const transitionKey = "orders-http-partner-transition-1"
		transition(otherStore, "PARTNER_ACCEPTED", transitionKey, 1, http.StatusForbidden)
		var state string
		var version int
		if err := db.QueryRowContext(ctx, "SELECT state,version FROM dsh.commerce_orders WHERE id=$1", order).Scan(&state, &version); err != nil {
			t.Fatal(err)
		}
		if state != "CREATED" || version != 1 {
			t.Fatalf("cross-Store Partner transition changed the Order: state=%s version=%d", state, version)
		}
		var auditCount int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.commerce_order_audit WHERE order_id=$1", order).Scan(&auditCount); err != nil {
			t.Fatal(err)
		}
		if auditCount != 0 {
			t.Fatalf("denied cross-Store transition wrote %d audit events", auditCount)
		}

		accepted := transition(store, "PARTNER_ACCEPTED", transitionKey, 1, http.StatusOK)
		if strings.Contains(accepted.Body.String(), `"idempotentReplay":true`) || !strings.Contains(accepted.Body.String(), `"state":"PARTNER_ACCEPTED"`) {
			t.Fatalf("authorized transition did not return its persisted first result: %s", accepted.Body.String())
		}
		replay := transition(store, "PARTNER_ACCEPTED", transitionKey, 1, http.StatusOK)
		if !strings.Contains(replay.Body.String(), `"idempotentReplay":true`) || !strings.Contains(replay.Body.String(), `"state":"PARTNER_ACCEPTED"`) {
			t.Fatalf("same authorized transition was not reported as an idempotent replay: %s", replay.Body.String())
		}
		transition(store, "PREPARING", transitionKey, 2, http.StatusConflict)
		if err := db.QueryRowContext(ctx, "SELECT state,version FROM dsh.commerce_orders WHERE id=$1", order).Scan(&state, &version); err != nil {
			t.Fatal(err)
		}
		if state != "PARTNER_ACCEPTED" || version != 2 {
			t.Fatalf("conflicting retry changed the Order: state=%s version=%d", state, version)
		}
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.commerce_order_audit WHERE order_id=$1", order).Scan(&auditCount); err != nil {
			t.Fatal(err)
		}
		if auditCount != 1 {
			t.Fatalf("idempotent replay or conflicting retry wrote duplicate audit events: got %d want 1", auditCount)
		}
		listA := call("orders-token-client-a", http.MethodGet, "/dsh/orders", "", http.StatusOK)
		listB := call("orders-token-client-b", http.MethodGet, "/dsh/orders", clientA, http.StatusOK)
		if !strings.Contains(listA.Body.String(), order) || strings.Contains(listB.Body.String(), order) {
			t.Fatal("client order list leaked across actor boundary")
		}
		t.Run("search and filters apply before pagination", func(t *testing.T) {
			// Create newer orders in the disposable database so the sole Store
			// match is outside the default first page.
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version)
				SELECT 'history-cart-'||n,$1,$2,'checked_out',1 FROM generate_series(1,51) AS series(n)`, clientA, otherStore); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
				(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
				service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,
				serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,
				payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor,created_at)
				SELECT 'history-order-'||n,$1,$2,'history-cart-'||n,'history-address',1,'History address',15.3694457,44.1910064,
					'orders-http-city','CITY_SCOPE_V1','SERVICEABLE',1,1,
					CASE n WHEN 1 THEN 'DELIVERED' WHEN 2 THEN 'CANCELLED' ELSE 'CREATED' END,
					1800,'YER',1,'history-payment-'||n,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800,
					clock_timestamp()+make_interval(secs=>n)
				FROM generate_series(1,51) AS series(n)`, clientA, otherStore); err != nil {
				t.Fatal(err)
			}
			type page struct {
				Orders     []struct{ ID string } `json:"orders"`
				NextCursor string                `json:"nextCursor"`
			}
			read := func(token, query string) page {
				t.Helper()
				response := call(token, http.MethodGet, "/dsh/orders?"+query, clientA, http.StatusOK)
				var result page
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				return result
			}
			const token = "orders-token-client-a"
			if first := read(token, "limit=50"); len(first.Orders) != 50 || first.NextCursor == "" {
				t.Fatalf("expected a first page of 50 newer Orders, got %d", len(first.Orders))
			}
			for _, tc := range []struct{ query, expected string }{
				{"q=http+STORE&status=active&fulfillmentMode=BTHWANI_CAPTAIN", order},
				{"q=ORDER-A", order},
				{"q=other+STORE&status=completed", "history-order-1"},
				{"q=other+STORE&status=cancelled", "history-order-2"},
				{"cartId=orders-http-cart", order},
			} {
				result := read(token, tc.query)
				if len(result.Orders) != 1 || result.Orders[0].ID != tc.expected || result.NextCursor != "" {
					t.Fatalf("query %q returned %+v, want only %s", tc.query, result, tc.expected)
				}
			}
			for _, query := range []string{"q=%25", "q=ORDER-A&fulfillmentMode=CUSTOMER_PICKUP"} {
				if result := read(token, query); len(result.Orders) != 0 || result.NextCursor != "" {
					t.Fatalf("query %q returned unrelated Orders: %+v", query, result)
				}
			}
			if result := read("orders-token-client-b", "q=ORDER-A"); len(result.Orders) != 0 {
				t.Fatalf("other Client saw private matching Orders: %+v", result)
			}
			const filter = "q=history-order&status=active&limit=1"
			first := read(token, filter)
			if len(first.Orders) != 1 || first.Orders[0].ID != "history-order-51" || first.NextCursor == "" {
				t.Fatalf("filtered first page %+v", first)
			}
			cursor := "&cursor=" + url.QueryEscape(first.NextCursor)
			if second := read(token, filter+cursor); len(second.Orders) != 1 || second.Orders[0].ID != "history-order-50" {
				t.Fatalf("filtered second page %+v", second)
			}
			call("orders-token-client-b", http.MethodGet, "/dsh/orders?"+filter+cursor, clientA, http.StatusBadRequest)
			for _, invalid := range []string{
				"q=order-a" + cursor, "cartId=orders-http-cart&q=order-a", "status=other", "fulfillmentMode=OTHER",
				"q=%ZZ", "q=%FF", "q=%00", "q=" + url.QueryEscape(strings.Repeat("ع", 129)),
				"q=order-a&q=other", "status=active&status=completed", "fulfillmentMode=BTHWANI_CAPTAIN&fulfillmentMode=CUSTOMER_PICKUP",
			} {
				call(token, http.MethodGet, "/dsh/orders?"+invalid, "", http.StatusBadRequest)
			}
		})
		if unexpectedPayment != 0 {
			t.Fatalf("read-only HTTP owner checks sent %d unexpected calls to WLT", unexpectedPayment)
		}
	})
}
