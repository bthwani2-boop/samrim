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
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical DSH schema: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", "sanaa_operator_ops", "صنعاء عمليات"); err != nil {
			t.Fatalf("insert service city fixture: %v", err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "store_operator_ops", PartnerActorID: "partner_operator_ops", Name: "متجر العمليات"})

		updatedAt := time.Date(2026, 9, 18, 6, 0, 0, 0, time.UTC)
		for index := 1; index <= 3; index++ {
			orderID := fmt.Sprintf("operator_order_%02d", index)
			cartID := "cart_" + orderID
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, "client_operator_ops", "store_operator_ops"); err != nil {
				t.Fatalf("insert cart fixture %s: %v", cartID, err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,1800,'YER',1,$8,$8)`, orderID, "client_operator_ops", "store_operator_ops", cartID, "address_"+orderID, "عنوان التشغيل", "sanaa_operator_ops", updatedAt); err != nil {
				t.Fatalf("insert order fixture %s: %v", orderID, err)
			}
		}

		first, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, "")
		if err != nil || len(first.Operations) != 2 || first.Operations[0].OrderID != "operator_order_03" || first.Operations[1].OrderID != "operator_order_02" || first.NextCursor == "" {
			t.Fatalf("first operator operations page is not stable: %+v err=%v", first, err)
		}
		if first.Summary.TotalCount != 3 || first.Summary.ActionableCount != 3 || first.Summary.AwaitingDispatchCount != 3 || first.Summary.ActiveCount != 0 || first.Summary.DeliveredCount != 0 || first.Summary.MeasuredAt.IsZero() {
			t.Fatalf("first-page summary must cover all filtered results, not the two loaded rows: %+v", first.Summary)
		}
		scoped, err := postgres.ListOrdersForOperatorStore(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, "", "store_operator_ops")
		if err != nil || len(scoped.Operations) != 2 || scoped.Summary.TotalCount != 3 || scoped.NextCursor == "" {
			t.Fatalf("Store-scoped operator first page must preserve exact Store totals: %+v err=%v", scoped, err)
		}
		scopedNext, err := postgres.ListOrdersForOperatorStore(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, scoped.NextCursor, "store_operator_ops")
		if err != nil || len(scopedNext.Operations) != 1 || scopedNext.Summary.TotalCount != 3 {
			t.Fatalf("Store-scoped pagination lost an order or changed totals: %+v err=%v", scopedNext, err)
		}
		if _, err := postgres.ListOrdersForOperatorStore(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, scoped.NextCursor, "another_store"); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("cross-Store continuation was accepted: %v", err)
		}
		scopedEmpty, err := postgres.ListOrdersForOperatorStore(ctx, db, "", "", "updated_desc", false, 10, "", "another_store")
		if err != nil || scopedEmpty.Summary.TotalCount != 0 || len(scopedEmpty.Operations) != 0 {
			t.Fatalf("Store-scoped read leaked orders from another Store: %+v err=%v", scopedEmpty, err)
		}

		second, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, first.NextCursor)
		if err != nil || len(second.Operations) != 1 || second.Operations[0].OrderID != "operator_order_01" || second.NextCursor != "" {
			t.Fatalf("second operator operations page is not stable: %+v err=%v", second, err)
		}
		if second.Summary.TotalCount != 3 || second.Summary.ActionableCount != 3 {
			t.Fatalf("cursor narrowed result-set summary: %+v", second.Summary)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "CAPTAIN_ASSIGNED", "", "updated_desc", true, 2, first.NextCursor); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected filter-bound cursor rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", false, 2, first.NextCursor); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected actionable filter-bound cursor rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, "not-a-cursor"); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected malformed cursor rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "a different search", "updated_desc", true, 2, first.NextCursor); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected search-bound cursor rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_asc", true, 2, first.NextCursor); !errors.Is(err, postgres.ErrOperatorOperationInvalidCursor) {
			t.Fatalf("expected sort-bound cursor rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "", strings.Repeat("ع", 129), "updated_desc", false, 2, ""); !errors.Is(err, postgres.ErrOperatorOperationInvalidQuery) {
			t.Fatalf("expected overlong Unicode search rejection, got %v", err)
		}
		if _, err := postgres.ListOrdersForOperator(ctx, db, "", "", "unsupported", false, 2, ""); !errors.Is(err, postgres.ErrOperatorOperationInvalidSort) {
			t.Fatalf("expected unsupported sort rejection, got %v", err)
		}
		matched, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "ORDER_02", "updated_desc", false, 10, "")
		if err != nil || len(matched.Operations) != 1 || matched.Operations[0].OrderID != "operator_order_02" {
			t.Fatalf("case-insensitive order identifier search failed: %+v err=%v", matched, err)
		}
		if matched.Summary.TotalCount != 1 || matched.Summary.AwaitingDispatchCount != 1 {
			t.Fatalf("summary ignored identifier search: %+v", matched.Summary)
		}
		empty, err := postgres.ListOrdersForOperator(ctx, db, "", "no-such-order", "updated_desc", false, 2, "")
		if err != nil || len(empty.Operations) != 0 || empty.Summary.TotalCount != 0 || empty.Summary.ActionableCount != 0 || empty.Summary.MeasuredAt.IsZero() {
			t.Fatalf("empty query must return a measured zero summary: %+v err=%v", empty, err)
		}
		literal, err := postgres.ListOrdersForOperator(ctx, db, "", "%", "updated_desc", false, 2, "")
		if err != nil || literal.Summary.TotalCount != 0 {
			t.Fatalf("summary expanded a literal wildcard search: %+v err=%v", literal, err)
		}
		storeMatches, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "متجر العمليات", "updated_desc", false, 10, "")
		if err != nil || len(storeMatches.Operations) != 3 {
			t.Fatalf("store name search failed: %+v err=%v", storeMatches, err)
		}
		ascending, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_asc", false, 2, "")
		if err != nil || len(ascending.Operations) != 2 || ascending.Operations[0].OrderID != "operator_order_01" || ascending.Operations[1].OrderID != "operator_order_02" || ascending.NextCursor == "" {
			t.Fatalf("ascending operator operations sort is not stable: %+v err=%v", ascending, err)
		}
		ascendingSecond, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_asc", false, 2, ascending.NextCursor)
		if err != nil || len(ascendingSecond.Operations) != 1 || ascendingSecond.Operations[0].OrderID != "operator_order_03" {
			t.Fatalf("ascending operator operations cursor is not stable: %+v err=%v", ascendingSecond, err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET fulfillment_modes=ARRAY['CUSTOMER_PICKUP']::text[],delivery_origin_latitude=15.369445,delivery_origin_longitude=44.191006,delivery_origin_version=1,delivery_origin_updated_at=clock_timestamp() WHERE id=$1`, "store_operator_ops"); err != nil {
			t.Fatalf("set pickup-capable store location: %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_orders SET fulfillment_mode='CUSTOMER_PICKUP',address_id=NULL,address_version=NULL,address_text=NULL,address_latitude=NULL,address_longitude=NULL,serviceability_policy_version=NULL,serviceability_status=NULL,serviceability_address_version=NULL,state='READY_FOR_PICKUP',payment_method='CASH_AT_STORE',payment_intent_id='intent_operator_ops',payment_state='REQUIRES_COLLECTION',version=version+1 WHERE id=$1`, "operator_order_02"); err != nil {
			t.Fatalf("convert fixture to a cash-at-store pickup order: %v", err)
		}
		actionable, err := postgres.ListOrdersForOperator(ctx, db, "", "", "updated_desc", true, 10, "")
		if err != nil || len(actionable.Operations) != 2 {
			t.Fatalf("actionable operator queue included a non-actionable order: %+v err=%v", actionable, err)
		}
		if actionable.Summary.TotalCount != 2 || actionable.Summary.ActionableCount != 2 || actionable.Summary.AwaitingDispatchCount != 2 || actionable.Summary.ActiveCount != 0 {
			t.Fatalf("summary ignored actionable filter: %+v", actionable.Summary)
		}
		all, err := postgres.ListOrdersForOperator(ctx, db, "", "", "updated_desc", false, 1, "")
		if err != nil || all.Summary.TotalCount != 3 || all.Summary.ActiveCount != 1 || all.Summary.ActionableCount != 2 {
			t.Fatalf("summary lost non-actionable active pickup orders: %+v err=%v", all.Summary, err)
		}
		pickup, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_PICKUP", "", "updated_desc", false, 1, "")
		if err != nil || pickup.Summary.TotalCount != 1 || pickup.Summary.ActiveCount != 1 || pickup.Summary.AwaitingDispatchCount != 0 || pickup.Summary.ActionableCount != 0 {
			t.Fatalf("summary ignored exact state filter: %+v err=%v", pickup.Summary, err)
		}
		for _, item := range actionable.Operations {
			if item.OrderID == "operator_order_02" {
				t.Fatal("ready-for-pickup order was included in the operator-action queue")
			}
		}
		clientOrders, err := postgres.ListOrdersForClient(ctx, db, "client_operator_ops", "", 50)
		if err != nil {
			t.Fatalf("list client orders with store pickup details: %v", err)
		}
		clientPage1, err := postgres.ListOrdersForClientPage(ctx, db, "client_operator_ops", 2, "")
		if err != nil || len(clientPage1.Orders) != 2 || clientPage1.Orders[0].ID != "operator_order_03" || clientPage1.Orders[1].ID != "operator_order_02" || clientPage1.NextCursor == "" {
			t.Fatalf("client first keyset page incorrect: %+v err=%v", clientPage1, err)
		}
		clientPage2, err := postgres.ListOrdersForClientPage(ctx, db, "client_operator_ops", 2, clientPage1.NextCursor)
		if err != nil || len(clientPage2.Orders) != 1 || clientPage2.Orders[0].ID != "operator_order_01" || clientPage2.NextCursor != "" {
			t.Fatalf("client second keyset page incorrect: %+v err=%v", clientPage2, err)
		}
		if _, err := postgres.ListOrdersForClientPage(ctx, db, "another_client", 2, clientPage1.NextCursor); !errors.Is(err, postgres.ErrClientOrdersInvalidCursor) {
			t.Fatalf("cross-client cursor unexpectedly allowed: %v", err)
		}
		partnerStores, err := postgres.ListPartnerOrdersAuthorizedStoreIDs(ctx, db, "partner_operator_ops")
		if err != nil || len(partnerStores) != 1 || partnerStores[0] != "store_operator_ops" {
			t.Fatalf("partner scope = %+v err=%v", partnerStores, err)
		}
		partnerCounts, err := postgres.CountPartnerOrderAttention(ctx, db, partnerStores)
		if err != nil || partnerCounts.AwaitingDispatch != 2 || partnerCounts.NewOrders != 0 {
			t.Fatalf("partner order attention = %+v err=%v", partnerCounts, err)
		}
		partnerPage1, err := postgres.ListOrdersForPartnerStores(ctx, db, partnerStores, nil, "", 2, "")
		if err != nil || len(partnerPage1.Orders) != 2 || partnerPage1.NextCursor == "" {
			t.Fatalf("partner orders first page = %+v err=%v", partnerPage1, err)
		}
		partnerPage2, err := postgres.ListOrdersForPartnerStores(ctx, db, partnerStores, nil, "", 2, partnerPage1.NextCursor)
		if err != nil || len(partnerPage2.Orders) != 1 || partnerPage2.NextCursor != "" {
			t.Fatalf("partner orders second page = %+v err=%v", partnerPage2, err)
		}
		filtered, err := postgres.ListOrdersForPartnerStores(ctx, db, partnerStores, []string{"READY_FOR_DISPATCH"}, "", 10, "")
		if err != nil || len(filtered.Orders) != 2 || filtered.NextCursor != "" {
			t.Fatalf("partner state filter = %+v err=%v", filtered, err)
		}
		noAccess, err := postgres.ListPartnerOrdersAuthorizedStoreIDs(ctx, db, "another-partner")
		if err != nil || len(noAccess) != 0 {
			t.Fatalf("unauthorized partner unexpectedly has store access: %+v err=%v", noAccess, err)
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
