package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/financialhandoff"
	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Test only with an expressly isolated PostgreSQL target; the shared local
// development database must never be used for finance proof fixtures.
func TestFinancialHandoffUnknownOutcomeAndConcurrentWorkers(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_FINANCIAL_HANDOFF_TEST_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("isolated DSH financial database not configured")
	}
	if os.Getenv("BTHWANI_FINANCIAL_PROOF_ISOLATED") != "1" {
		t.Fatal("explicit disposable database acknowledgment required")
	}
	root, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, rootURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		keys, err := postgres.NewDeliveryProofKeyring("test-v1", map[string]string{"test-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="})
		if err != nil {
			t.Fatal(err)
		}
		if err := postgres.Migrate(ctx, db, records, migrations, keys); err != nil {
			t.Fatalf("migrate isolated schema: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify isolated schema: %v", err)
		}
		const city, store, cart, order = "handoff-city", "handoff-store", "handoff-cart", "handoff-order"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "handoff-partner", Name: "Test Store"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'handoff-client',$2,'checked_out',1)", cart, store); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor) VALUES($1,'handoff-client',$2,$3,'handoff-address',1,'Test address',15.3694457,44.1910064,$4,'CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,'handoff-payment','CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)", order, store, cart, city); err != nil {
			t.Fatalf("seed isolated order: %v", err)
		}
		add := func(id, source string) {
			t.Helper()
			_, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_financial_handoff_outbox (id,effect_type,source_ref,order_id,payment_intent_id,captain_actor_id,amount_minor,idempotency_key,correlation_id,acting_actor_id) VALUES($1,'CAPTAIN_COD_RELEASE',$2,$3,'handoff-payment','handoff-captain',0,$4,$5,'handoff-operator')", id, source, order, "handoff-key-"+source, "handoff-correlation-"+source)
			if err != nil {
				t.Fatal(err)
			}
		}
		assertState := func(id, state string, attempts int) {
			t.Helper()
			var actual string
			var count int
			err := db.QueryRowContext(ctx, "SELECT state,attempts FROM dsh.commerce_financial_handoff_outbox WHERE id=$1", id).Scan(&actual, &count)
			if err != nil || actual != state || count != attempts {
				t.Fatalf("outbox %s state=%s attempts=%d err=%v, want %s/%d", id, actual, count, err, state, attempts)
			}
		}
		t.Run("wlt_commits_then_response_is_lost", func(t *testing.T) {
			add("handoff-unknown", "unknown")
			var mu sync.Mutex
			calls := 0
			seen := map[string]int{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || !strings.HasSuffix(r.URL.Path, "/release") {
					http.Error(w, "wrong path", 404)
					return
				}
				key := r.Header.Get("Idempotency-Key")
				if key == "" {
					http.Error(w, "no idempotency key", 400)
					return
				}
				mu.Lock()
				calls++
				seen[key] = 1
				first := calls == 1
				mu.Unlock()
				if first {
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Errorf("close committed response: %v", err)
						return
					}
					_ = conn.Close()
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"reservation": map[string]any{}, "idempotentReplay": true})
			}))
			defer server.Close()
			client, err := wlt.New(server.URL, "test", "isolated-proof-token")
			if err != nil {
				t.Fatal(err)
			}
			service, err := financialhandoff.New(db, client)
			if err != nil {
				t.Fatal(err)
			}
			if err := service.Reconcile(ctx); err == nil {
				t.Fatal("lost response must not be reported successful")
			}
			assertState("handoff-unknown", "FAILED", 1)
			if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_financial_handoff_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id='handoff-unknown'"); err != nil {
				t.Fatal(err)
			}
			if err := service.Reconcile(ctx); err != nil {
				t.Fatalf("replayed committed WLT effect: %v", err)
			}
			assertState("handoff-unknown", "POSTED", 2)
			mu.Lock()
			defer mu.Unlock()
			if calls != 2 || len(seen) != 1 {
				t.Fatalf("WLT attempts=%d uniqueKeys=%d, want 2/1", calls, len(seen))
			}
		})
		t.Run("two_workers_see_same_pending_handoff", func(t *testing.T) {
			add("handoff-concurrent", "concurrent")
			var mu sync.Mutex
			seen := map[string]int{}
			calls := 0
			release := make(chan struct{})
			entered := make(chan struct{}, 2)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				calls++
				seen[r.Header.Get("Idempotency-Key")] = 1
				mu.Unlock()
				entered <- struct{}{}
				<-release
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"reservation": map[string]any{}, "idempotentReplay": true})
			}))
			defer server.Close()
			client, err := wlt.New(server.URL, "test", "isolated-proof-token")
			if err != nil {
				t.Fatal(err)
			}
			one, err := financialhandoff.New(db, client)
			if err != nil {
				t.Fatal(err)
			}
			two, err := financialhandoff.New(db, client)
			if err != nil {
				t.Fatal(err)
			}
			errs := make(chan error, 2)
			go func() { errs <- one.Reconcile(ctx) }()
			go func() { errs <- two.Reconcile(ctx) }()
			for i := 0; i < 2; i++ {
				select {
				case <-entered:
				case <-time.After(5 * time.Second):
					close(release)
					t.Fatal("workers did not both reach WLT")
				}
			}
			close(release)
			if err := errors.Join(<-errs, <-errs); err != nil {
				t.Fatalf("concurrent reconciliation: %v", err)
			}
			assertState("handoff-concurrent", "POSTED", 1)
			mu.Lock()
			defer mu.Unlock()
			if calls != 2 || len(seen) != 1 || seen[""] != 0 {
				t.Fatalf("WLT calls=%d distinct nonempty keys=%d, want 2/1", calls, len(seen))
			}
		})
	})
}
