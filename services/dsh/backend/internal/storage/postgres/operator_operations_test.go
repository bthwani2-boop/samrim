package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperatorOperationsCursorPagination(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for operator operations read-model proof")
	}

	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", "sanaa_operator_ops", "صنعاء عمليات"); err != nil {
			t.Fatalf("insert service city fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name) VALUES($1,$2,$3)", "store_operator_ops", "partner_operator_ops", "متجر العمليات"); err != nil {
			t.Fatalf("insert store fixture: %v", err)
		}

		updatedAt := time.Date(2026, 9, 18, 6, 0, 0, 0, time.UTC)
		for index := 1; index <= 3; index++ {
			orderID := fmt.Sprintf("operator_order_%02d", index)
			cartID := "cart_" + orderID
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, "client_operator_ops", "store_operator_ops"); err != nil {
				t.Fatalf("insert cart fixture %s: %v", cartID, err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,'YER',1,$8,$8)`, orderID, "client_operator_ops", "store_operator_ops", cartID, "address_"+orderID, "عنوان التشغيل", "sanaa_operator_ops", updatedAt); err != nil {
				t.Fatalf("insert order fixture %s: %v", orderID, err)
			}
		}

		first, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", 2, "")
		if err != nil || len(first.Operations) != 2 || first.Operations[0].OrderID != "operator_order_03" || first.Operations[1].OrderID != "operator_order_02" || first.NextCursor == "" {
			t.Fatalf("first operator operations page is not stable: %+v err=%v", first, err)
		}
		second, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", 2, first.NextCursor)
		if err != nil || len(second.Operations) != 1 || second.Operations[0].OrderID != "operator_order_01" || second.NextCursor != "" {
			t.Fatalf("second operator operations page is not stable: %+v err=%v", second, err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "CAPTAIN_ASSIGNED", 2, first.NextCursor); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected filter-bound cursor rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", 2, "not-a-cursor"); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected malformed cursor rejection, got %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET fulfillment_modes=ARRAY['CUSTOMER_PICKUP']::text[],delivery_origin_latitude=15.369445,delivery_origin_longitude=44.191006,delivery_origin_version=1,delivery_origin_updated_at=clock_timestamp() WHERE id=$1`, "store_operator_ops"); err != nil {
			t.Fatalf("set pickup-capable store location: %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_orders SET fulfillment_mode='CUSTOMER_PICKUP',address_id=NULL,address_version=NULL,address_text=NULL,address_latitude=NULL,address_longitude=NULL,serviceability_policy_version=NULL,serviceability_status=NULL,serviceability_address_version=NULL,state='READY_FOR_PICKUP',payment_method='CASH_AT_STORE',payment_intent_id='intent_operator_ops',payment_state='REQUIRES_COLLECTION',version=version+1 WHERE id=$1`, "operator_order_02"); err != nil {
			t.Fatalf("convert fixture to a cash-at-store pickup order: %v", err)
		}
		clientOrders, err := postgres.ListOrdersForClient(ctx, db, "client_operator_ops", "", 50)
		if err != nil {
			t.Fatalf("list client orders with store pickup details: %v", err)
		}
		var pickupOrder *postgres.OrderRecord
		for index := range clientOrders {
			if clientOrders[index].ID == "operator_order_02" {
				pickupOrder = &clientOrders[index]
				break
			}
		}
		if pickupOrder == nil || pickupOrder.StoreName != "متجر العمليات" || pickupOrder.PickupLocation == nil || pickupOrder.PickupLocation.Latitude != 15.369445 || pickupOrder.PickupLocation.Longitude != 44.191006 {
			t.Fatalf("client pickup order is missing the store name or current location: %+v", pickupOrder)
		}
		detail, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_02")
		if err != nil || detail.StoreName != "متجر العمليات" || detail.Order.StoreName != "متجر العمليات" || detail.Order.PickupLocation == nil || detail.Order.PickupLocation.Latitude != 15.369445 || detail.Order.PickupLocation.Longitude != 44.191006 {
			t.Fatalf("operator detail read model is missing store pickup details: %+v err=%v", detail, err)
		}
	})
}
