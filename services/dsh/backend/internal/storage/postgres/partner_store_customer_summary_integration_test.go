package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// This test NEVER uses the running application's DSH database. It requires
// a disposable root DSN; withFreshDatabase makes and drops an isolated DB.
func TestPartnerStoreCustomerCountsAreScopedAndPeriodAware(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	rootDB, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	withFreshDatabase(t, rootDB, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for _, stmt := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('sum-city','Test City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('sum-vertical','Test Vertical','Test Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('sum-type','sum-vertical','Test Type','Test Type')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('sum-store-a','sum-partner-a','Store A','sum-city','sum-vertical','sum-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('sum-store-b','sum-partner-b','Store B','sum-city','sum-vertical','sum-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				t.Fatal(err)
			}
		}
		orders := []struct {
			id, store, client, state string
			value                    int64
			ageDays                  int
		}{
			{"a1", "sum-store-a", "client-a", "DELIVERED", 100, 0},
			{"a2", "sum-store-a", "client-a", "PICKED_UP", 200, 0},
			{"b1", "sum-store-a", "client-b", "DELIVERED", 300, 0},
			{"c1", "sum-store-a", "client-c", "CANCELLED", 400, 0},
			{"old", "sum-store-a", "client-d", "DELIVERED", 700, 40},
			{"cross", "sum-store-b", "client-a", "DELIVERED", 500, 0},
		}
		for _, order := range orders {
			cartID := "sum-cart-" + order.id
			orderID := "sum-order-" + order.id
			if _, err := db.ExecContext(ctx,
				"INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)",
				cartID, order.client, order.store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
				id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,
				state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,
				fulfillment_mode,payment_cash_amount_minor,cancellation_mode,cancellation_policy_version,created_at)
				VALUES($1,$2,$3,$4,'sum-city',1,$5,$6,'YER',1,$7,'CASH_AT_STORE','REQUIRES_COLLECTION',
				'CUSTOMER_PICKUP',$6,'OPERATIONS_ONLY',1,$8)`,
				orderID, order.client, order.store, cartID, order.state, order.value,
				"sum-payment-"+order.id, time.Now().UTC().AddDate(0, 0, -order.ageDays)); err != nil {
				t.Fatal(err)
			}
		}
		recent := time.Now().AddDate(0, 0, -30)
		a, err := postgres.ReadPartnerStoreOrderSummary(ctx, db, "sum-store-a", "30d", &recent)
		if err != nil {
			t.Fatal(err)
		}
		if a.TotalOrders != 4 || a.DeliveredOrders != 2 || a.PickedUpOrders != 1 ||
			a.CancelledOrders != 1 || a.CompletedOrderValueMinor != 600 ||
			a.CompletedCustomers != 2 || a.ReturningCustomers != 1 {
			t.Fatalf("wrong Store A 30d scope or counts: %+v", a)
		}
		b, err := postgres.ReadPartnerStoreOrderSummary(ctx, db, "sum-store-b", "30d", &recent)
		if err != nil {
			t.Fatal(err)
		}
		if b.TotalOrders != 1 || b.CompletedOrderValueMinor != 500 ||
			b.CompletedCustomers != 1 || b.ReturningCustomers != 0 {
			t.Fatalf("cross-Store data leaked: %+v", b)
		}
		all, err := postgres.ReadPartnerStoreOrderSummary(ctx, db, "sum-store-a", "all", nil)
		if err != nil {
			t.Fatal(err)
		}
		if all.TotalOrders != 5 || all.CompletedCustomers != 3 ||
			all.ReturningCustomers != 1 || all.CompletedOrderValueMinor != 1300 {
			t.Fatalf("full-period Store A aggregate is wrong: %+v", all)
		}
	})
}
