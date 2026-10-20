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
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

// This is an authenticated HTTP boundary proof, not just a persistence query.
// Each test receives a fresh, owned database from withFreshDatabase.
func TestNotificationHTTPRejectsAuthenticatedCrossActorReadsAndMutations(t *testing.T) {
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
		const clientA = "notif-http-client-a"
		const clientB = "notif-http-client-b"
		const partnerA = "notif-http-partner-a"
		const partnerB = "notif-http-partner-b"
		const store = "notif-http-store-a"
		const order = "notif-http-order-a"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('notif-http-city','مدينة الاختبار',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: partnerA, Name: "Proof Notification Store", ServiceCityID: "notif-http-city"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('notif-http-cart',$1,$2,'checked_out',1)", clientA, store); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
		 (id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
		  service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,
		  serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,
		  payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
		 VALUES($1,$2,$3,'notif-http-cart','notif-http-address',1,'Proof address',15.3694457,44.1910064,
		  'notif-http-city','CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,'notif-http-payment',
		  'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, order, clientA, store); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
		  (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at)
		  VALUES('order_created','notif-http-audit-key','notif-http-correlation',$1,$2,'','CREATED',0,1,'notif-http-hash',clock_timestamp())`, clientA, order); err != nil {
			t.Fatal(err)
		}

		sessions := map[string]struct{ subject, role, surface string }{
			"notif-token-client-a":  {clientA, "client", "app-client"},
			"notif-token-client-b":  {clientB, "client", "app-client"},
			"notif-token-partner-a": {partnerA, "partner", "app-partner"},
			"notif-token-partner-b": {partnerB, "partner", "app-partner"},
		}
		identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/auth/session" {
				http.NotFound(w, r)
				return
			}
			actor, ok := sessions[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
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
		defer identityServer.Close()
		endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identity, err := identityintegration.New(endpoint, strings.Repeat("i", 32))
		if err != nil {
			t.Fatal(err)
		}
		server, err := transporthttp.NewNotification(identity, strings.Repeat("s", 32), db)
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		server.Register(mux)
		call := func(token, method, path, forgedID string, status int) *httptest.ResponseRecorder {
			t.Helper()
			request := httptest.NewRequest(method, path, nil)
			if token != "" {
				request.Header.Set("Authorization", "Bearer "+token)
			}
			if forgedID != "" {
				request.Header.Set("X-Acting-Actor-ID", forgedID)
				request.Header.Set("X-Actor-ID", forgedID)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != status {
				t.Fatalf("%s %s as %s returned %d, expected %d: %s", method, path, token, response.Code, status, response.Body.String())
			}
			return response
		}
		owner := call("notif-token-client-a", "GET", "/dsh/notifications", "", 200)
		var result struct {
			Notifications []struct {
				ID string `json:"id"`
			} `json:"notifications"`
			UnreadCount int `json:"unreadCount"`
		}
		if err := json.Unmarshal(owner.Body.Bytes(), &result); err != nil || len(result.Notifications) != 1 || result.UnreadCount != 1 {
			t.Fatalf("owned notification missing: %s error=%v", owner.Body.String(), err)
		}
		id := result.Notifications[0].ID
		foreign := call("notif-token-client-b", "GET", "/dsh/notifications", clientA, 200)
		if strings.Contains(foreign.Body.String(), id) || strings.Contains(foreign.Body.String(), order) {
			t.Fatal("client B received client A notification despite canonical session boundary")
		}
		otherPartner := call("notif-token-partner-b", "GET", "/dsh/notifications", partnerA, 200)
		if strings.Contains(otherPartner.Body.String(), id) || strings.Contains(otherPartner.Body.String(), order) {
			t.Fatal("partner B received partner A store notification")
		}
		partner := call("notif-token-partner-a", "GET", "/dsh/notifications", "", 200)
		if !strings.Contains(partner.Body.String(), order) {
			t.Fatal("store owner did not receive its order notification")
		}
		markPath := "/dsh/notifications/" + id + "/read"
		call("notif-token-client-b", "POST", markPath, clientA, 404)
		unchanged := call("notif-token-client-a", "GET", "/dsh/notifications", "", 200)
		if !strings.Contains(unchanged.Body.String(), `"unreadCount":1`) {
			t.Fatalf("foreign mark changed owned read-state: %s", unchanged.Body.String())
		}
		call("notif-token-client-a", "POST", markPath, "", 200)
		updated := call("notif-token-client-a", "GET", "/dsh/notifications", "", 200)
		if !strings.Contains(updated.Body.String(), `"unreadCount":0`) {
			t.Fatalf("owned mark was not persisted: %s", updated.Body.String())
		}
		call("", "GET", "/dsh/notifications", clientA, 401)
	})
}
