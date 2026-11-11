package postgres_test

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPartnerOrderPageRejectsUnsafeSearchAndCursor(t *testing.T) {
	// No database connection is available: invalid input must be rejected
	// before any SQL is sent, including non-UTF8 and embedded NUL bytes.
	db, err := sql.Open("postgres", "postgres://invalid:invalid@127.0.0.1:1/not_used?sslmode=disable")
	if err != nil {
		t.Fatalf("create disconnected database handle: %v", err)
	}
	defer db.Close()
	ctx := context.Background()
	stores := []string{"store_owned"}
	for _, query := range []string{"\x00", string([]byte{0xff}), strings.Repeat("ع", 129)} {
		if _, err := postgres.ListOrdersForPartnerStores(ctx, db, stores, nil, query, 10, ""); !errors.Is(err, postgres.ErrPartnerOrdersInvalidQuery) {
			t.Fatalf("unsafe Partner order query %q was not rejected before SQL: %v", query, err)
		}
	}
	for _, cursor := range []string{"malformed", strings.Repeat("A", 4097)} {
		if _, err := postgres.ListOrdersForPartnerStores(ctx, db, stores, nil, "", 10, cursor); !errors.Is(err, postgres.ErrPartnerOrdersInvalidCursor) {
			t.Fatalf("unsafe Partner order cursor was not rejected before SQL: %v", err)
		}
	}
	// A structurally valid cursor from a different Store scope must be denied
	// before any database connection is attempted, not silently trim the page.
	foreignScopeCursor := base64.RawURLEncoding.EncodeToString([]byte(`{"createdAt":"2026-11-11T10:00:00Z","id":"order_01","state":"","query":"","storeScope":"foreign_store_scope"}`))
	if _, err := postgres.ListOrdersForPartnerStores(ctx, db, stores, nil, "", 10, foreignScopeCursor); !errors.Is(err, postgres.ErrPartnerOrdersInvalidCursor) {
		t.Fatalf("foreign Store-scope cursor unexpectedly reached SQL: %v", err)
	}
}

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

		// Partner page batching must preserve nonempty canonical Order lines,
		// per-line immutable snapshots and attributed adjustments, including
		// an Order on the continuation page and an empty child collection.
		for _, orderID := range []string{"operator_order_01", "operator_order_03"} {
			lineID := "line_" + orderID
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_lines
				(id,order_id,store_offer_id,variant_id,product_id,product_name,variant_title,
				 measurement_kind,base_unit,pricing_basis,quantity_policy,quantity_min_base_units,
				 quantity_max_base_units,quantity_step_base_units,pricing_unit_base_units,
				 requested_quantity_base_units,unit_price_minor,line_amount_minor,currency)
				VALUES($1,$2,$3,$4,$5,'سلعة','أساسي','COUNT','unit','PER_UNIT',
				'FIXED',1,100,1,1,2,900,1800,'YER')`,
				lineID, orderID, "offer_"+orderID, "variant_"+orderID, "product_"+orderID); err != nil {
				t.Fatalf("insert Partner Order line %s: %v", orderID, err)
			}
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_line_modifier_snapshots
			(order_line_id,option_id,option_name_ar,price_delta_minor)
			VALUES('line_operator_order_03','addon_03','إضافة',0)`); err != nil {
			t.Fatalf("insert Partner Order modifier snapshot: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_line_attribute_snapshots
			(order_line_id,attribute_id,attribute_code,value_kind,text_value)
			VALUES('line_operator_order_03','size_03','size','TEXT','large')`); err != nil {
			t.Fatalf("insert Partner Order attribute snapshot: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustments
			(id,order_id,order_line_id,kind,state,customer_decision_required,
			requested_by_actor_id,requested_by_role)
			VALUES('adjust_order_01','operator_order_01','line_operator_order_01',
			'REMOVE_ITEM','PROPOSED',false,'partner_operator_ops','partner')`); err != nil {
			t.Fatalf("insert Partner Order adjustment: %v", err)
		}

		// The current stage clock is an owner transition event, not a
		// refreshed order updated_at value. The synthetic source is 1 min earlier.
		stageAt := updatedAt.Add(-time.Minute)
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
            (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at)
            VALUES('order_ready_for_dispatch','ops-stage-event-03','ops-stage-corr-03','partner_operator_ops',
                   'operator_order_03','PREPARING','READY_FOR_DISPATCH',1,2,'stage-verified',$1)`, stageAt); err != nil {
			t.Fatalf("insert canonical dispatch stage transition: %v", err)
		}
		first, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", true, 2, "")
		if err != nil || len(first.Operations) != 2 || first.Operations[0].OrderID != "operator_order_03" || first.Operations[1].OrderID != "operator_order_02" || first.NextCursor == "" {
			t.Fatalf("first operator operations page is not stable: %+v err=%v", first, err)
		}
		if first.Operations[0].StageStartedAt == nil || !first.Operations[0].StageStartedAt.Equal(stageAt) ||
			first.Operations[1].StageStartedAt != nil {
			t.Fatalf("stage elapsed must use owner transition; unavailable source stays null: %+v", first.Operations)
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
		clientPage1, err := postgres.ListOrdersForClientPage(ctx, db, "client_operator_ops", 2, "", postgres.ClientOrdersFilters{})
		if err != nil || len(clientPage1.Orders) != 2 || clientPage1.Orders[0].ID != "operator_order_03" || clientPage1.Orders[1].ID != "operator_order_02" || clientPage1.NextCursor == "" {
			t.Fatalf("client first keyset page incorrect: %+v err=%v", clientPage1, err)
		}
		clientPage2, err := postgres.ListOrdersForClientPage(ctx, db, "client_operator_ops", 2, clientPage1.NextCursor, postgres.ClientOrdersFilters{})
		if err != nil || len(clientPage2.Orders) != 1 || clientPage2.Orders[0].ID != "operator_order_01" || clientPage2.NextCursor != "" {
			t.Fatalf("client second keyset page incorrect: %+v err=%v", clientPage2, err)
		}
		if _, err := postgres.ListOrdersForClientPage(ctx, db, "another_client", 2, clientPage1.NextCursor, postgres.ClientOrdersFilters{}); !errors.Is(err, postgres.ErrClientOrdersInvalidCursor) {
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
		// The same opaque cursor must not be reused if the server-authorized
		// Store set changes, even though no forbidden Order is returned by SQL.
		if _, err := postgres.ListOrdersForPartnerStores(ctx, db, []string{"some_other_store"}, nil, "", 2, partnerPage1.NextCursor); !errors.Is(err, postgres.ErrPartnerOrdersInvalidCursor) {
			t.Fatalf("Partner cursor ignored authorized Store-scope change: %v", err)
		}
		partnerPage2, err := postgres.ListOrdersForPartnerStores(ctx, db, partnerStores, nil, "", 2, partnerPage1.NextCursor)
		if err != nil || len(partnerPage2.Orders) != 1 || partnerPage2.NextCursor != "" {
			t.Fatalf("partner orders second page = %+v err=%v", partnerPage2, err)
		}
		// Both pages use the same sorted Order projection, and children must
		// be attached only to their corresponding canonical Order.
		pageByID := make(map[string]postgres.OrderRecord)
		for _, order := range append(partnerPage1.Orders, partnerPage2.Orders...) {
			pageByID[order.ID] = order
		}
		withModifiers := pageByID["operator_order_03"]
		if len(withModifiers.Lines) != 1 || withModifiers.Lines[0].ID != "line_operator_order_03" ||
			len(withModifiers.Lines[0].ModifierSnapshots) != 1 || withModifiers.Lines[0].ModifierSnapshots[0].OptionID != "addon_03" ||
			len(withModifiers.Lines[0].AttributeSnapshots) != 1 || withModifiers.Lines[0].AttributeSnapshots[0].Code != "size" ||
			len(withModifiers.Adjustments) != 0 {
			t.Fatalf("Partner batch lost or misrouted historical line snapshots: %+v", withModifiers)
		}
		withAdjustment := pageByID["operator_order_01"]
		if len(withAdjustment.Lines) != 1 || withAdjustment.Lines[0].ID != "line_operator_order_01" ||
			len(withAdjustment.Lines[0].ModifierSnapshots) != 0 || len(withAdjustment.Lines[0].AttributeSnapshots) != 0 ||
			len(withAdjustment.Adjustments) != 1 || withAdjustment.Adjustments[0].ID != "adjust_order_01" {
			t.Fatalf("Partner continuation batch lost or misrouted Order adjustment: %+v", withAdjustment)
		}
		emptyChildren := pageByID["operator_order_02"]
		if emptyChildren.ID != "operator_order_02" || emptyChildren.Lines == nil || emptyChildren.Adjustments == nil ||
			len(emptyChildren.Lines) != 0 || len(emptyChildren.Adjustments) != 0 {
			t.Fatalf("Partner batch changed empty Order child collections: %+v", emptyChildren)
		}
		filtered, err := postgres.ListOrdersForPartnerStores(ctx, db, partnerStores, []string{"READY_FOR_DISPATCH"}, "", 10, "")
		if err != nil || len(filtered.Orders) != 2 || filtered.NextCursor != "" {
			t.Fatalf("partner state filter = %+v err=%v", filtered, err)
		}
		noAccess, err := postgres.ListPartnerOrdersAuthorizedStoreIDs(ctx, db, "another-partner")
		if err != nil || len(noAccess) != 0 {
			t.Fatalf("unauthorized partner unexpectedly has store access: %+v err=%v", noAccess, err)
		}
		// Store grants are returned as a set, not in a stable query order.
		// Reordering the same two authorized Stores must preserve continuation.
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: "store_operator_ops_second", PartnerActorID: "partner_operator_ops", Name: "متجر ثانٍ",
		})
		bothStores, err := postgres.ListPartnerOrdersAuthorizedStoreIDs(ctx, db, "partner_operator_ops")
		if err != nil || len(bothStores) != 2 {
			t.Fatalf("expected two authorized Partner Stores: %+v err=%v", bothStores, err)
		}
		pageWithBoth, err := postgres.ListOrdersForPartnerStores(ctx, db, bothStores, nil, "", 2, "")
		if err != nil || len(pageWithBoth.Orders) != 2 || pageWithBoth.NextCursor == "" {
			t.Fatalf("multi-Store Partner page missing cursor: %+v err=%v", pageWithBoth, err)
		}
		reversed := []string{bothStores[1], bothStores[0]}
		continuation, err := postgres.ListOrdersForPartnerStores(ctx, db, reversed, nil, "", 2, pageWithBoth.NextCursor)
		if err != nil || len(continuation.Orders) != 1 || continuation.Orders[0].ID != "operator_order_01" {
			t.Fatalf("authorized Store order changed Partner continuation: %+v err=%v", continuation, err)
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
		if err != nil || detail.StoreName != "متجر العمليات" || detail.Order.StoreName != "متجر العمليات" || detail.Order.PickupLocation == nil || detail.Order.PickupLocation.Latitude != 15.369445 || detail.Order.PickupLocation.Longitude != 44.191006 || detail.CustomerSuccessfulOrdersCount != 0 || detail.SuccessfulOrderOrdinal != 0 {
			t.Fatalf("operator detail read model is missing store pickup or initial successful-order facts: %+v err=%v", detail, err)
		}
		// The first three successes are based on completed deliveries or customer
		// pickups, not created orders, Captain store pickup, or current state alone.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_orders SET state='PICKED_UP',version=version+1 WHERE id='operator_order_02'`); err != nil {
			t.Fatalf("complete customer pickup: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at)
			VALUES('order_picked_up','ops-pickup-1','ops-pickup-corr','partner_operator_ops','operator_order_02','READY_FOR_PICKUP','PICKED_UP',2,3,'pickup-proof',timestamp '2026-09-18 06:02:00+00')`); err != nil {
			t.Fatalf("insert canonical pickup completion audit: %v", err)
		}
		pickupStage, err := postgres.ListOrdersForOperator(ctx, db, "PICKED_UP", "", "updated_desc", false, 10, "")
		if err != nil || len(pickupStage.Operations) != 1 || pickupStage.Operations[0].StageStartedAt == nil ||
			!pickupStage.Operations[0].StageStartedAt.Equal(time.Date(2026, 9, 18, 6, 2, 0, 0, time.UTC)) {
			t.Fatalf("customer pickup stage missing canonical audit timestamp: %+v err=%v", pickupStage, err)
		}
		afterPickup, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_02")
		if err != nil || afterPickup.CustomerSuccessfulOrdersCount != 1 || afterPickup.SuccessfulOrderOrdinal != 1 {
			t.Fatalf("customer pickup must be first confirmed success: %+v err=%v", afterPickup, err)
		}
		if len(afterPickup.History) != 1 || afterPickup.History[0].Source != "order" || afterPickup.History[0].EventType != "order_picked_up" || afterPickup.History[0].State != "PICKED_UP" || afterPickup.History[0].ActorID != "partner_operator_ops" || afterPickup.HistoryHasMore {
			t.Fatalf("operator history must reflect the persisted pickup audit without unrelated order events: %+v", afterPickup.History)
		}
		awaiting, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_01")
		if err != nil || awaiting.CustomerSuccessfulOrdersCount != 1 || awaiting.SuccessfulOrderOrdinal != 0 {
			t.Fatalf("an open delivery must not count as a successful order: %+v err=%v", awaiting, err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_orders SET state='DELIVERED',version=version+1 WHERE id='operator_order_01'`); err != nil {
			t.Fatalf("mark first delivery terminal: %v", err)
		}
		withoutProof, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_01")
		if err != nil || withoutProof.CustomerSuccessfulOrdersCount != 1 || withoutProof.SuccessfulOrderOrdinal != 0 {
			t.Fatalf("terminal state without canonical delivery proof must not count: %+v err=%v", withoutProof, err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,to_state,result_version,request_hash,created_at)
			VALUES('delivery_completed','ops-delivery-1','ops-delivery-corr','captain_operator_ops','operator_order_01','delivered',2,'delivery-proof',timestamp '2026-09-18 06:03:00+00')`); err != nil {
			t.Fatalf("insert canonical Captain delivery completion audit: %v", err)
		}
		deliveryStage, err := postgres.ListOrdersForOperator(ctx, db, "DELIVERED", "", "updated_desc", false, 10, "")
		if err != nil || len(deliveryStage.Operations) != 1 || deliveryStage.Operations[0].StageStartedAt == nil ||
			!deliveryStage.Operations[0].StageStartedAt.Equal(time.Date(2026, 9, 18, 6, 3, 0, 0, time.UTC)) {
			t.Fatalf("Captain delivery stage missing its canonical event timestamp: %+v err=%v", deliveryStage, err)
		}
		afterDelivery, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_01")
		if err != nil || afterDelivery.CustomerSuccessfulOrdersCount != 2 || afterDelivery.SuccessfulOrderOrdinal != 2 {
			t.Fatalf("confirmed Captain delivery must count after completed customer pickup: %+v err=%v", afterDelivery, err)
		}
		if len(afterDelivery.History) != 1 || afterDelivery.History[0].Source != "captain" || afterDelivery.History[0].EventType != "delivery_completed" || afterDelivery.History[0].State != "delivered" || afterDelivery.History[0].ActorID != "captain_operator_ops" || afterDelivery.HistoryHasMore {
			t.Fatalf("operator history must reflect actual Captain completion, not a guessed order transition: %+v", afterDelivery.History)
		}
		firstSuccess, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_02")
		if err != nil || firstSuccess.CustomerSuccessfulOrdersCount != 2 || firstSuccess.SuccessfulOrderOrdinal != 1 {
			t.Fatalf("customer success rank must remain completion-event ordered: %+v err=%v", firstSuccess, err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_orders SET state='DELIVERED',version=version+1 WHERE id='operator_order_03'`); err != nil {
			t.Fatalf("mark third delivery terminal: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,to_state,result_version,request_hash,created_at)
			VALUES('delivery_completed','ops-delivery-3','ops-delivery-corr-3','captain_operator_ops','operator_order_03','delivered',2,'delivery-proof-3',timestamp '2026-09-18 06:04:00+00')`); err != nil {
			t.Fatalf("insert third canonical delivery completion audit: %v", err)
		}
		thirdSuccess, err := postgres.ReadOperatorOperation(ctx, db, "operator_order_03")
		if err != nil || thirdSuccess.CustomerSuccessfulOrdersCount != 3 || thirdSuccess.SuccessfulOrderOrdinal != 3 {
			t.Fatalf("third confirmed success must be ranked and bounded: %+v err=%v", thirdSuccess, err)
		}

		// Old orders awaiting the partner must be visible for operator review,
		// but recent work and completed orders must not pollute the queue.
		var reviewNow time.Time
		if err := db.QueryRowContext(ctx, "SELECT statement_timestamp()").Scan(&reviewNow); err != nil {
			t.Fatalf("read operator queue database clock: %v", err)
		}
		for _, fixture := range []struct {
			id    string
			state string
			age   time.Duration
		}{
			{"operator_review_stalled", "PREPARING", -90 * time.Minute},
			{"operator_review_recent", "PREPARING", -5 * time.Minute},
			{"operator_review_terminal", "DELIVERED", -90 * time.Minute},
		} {
			cartID := "cart_" + fixture.id
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, "client_operator_ops", "store_operator_ops"); err != nil {
				t.Fatalf("insert review cart %s: %v", fixture.id, err)
			}
			changedAt := reviewNow.Add(fixture.age)
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,created_at,updated_at)
				VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,$8,1800,1800,'YER',2,$9,$9)`, fixture.id, "client_operator_ops", "store_operator_ops", cartID, "address_"+fixture.id, "عنوان الاختبار", "sanaa_operator_ops", fixture.state, changedAt); err != nil {
				t.Fatalf("insert review order %s: %v", fixture.id, err)
			}
			if fixture.state == "PREPARING" {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
					(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at)
					VALUES('order_preparing',$1,$2,'partner_operator_ops',$3,'PARTNER_ACCEPTED','PREPARING',1,2,'review-proof',$4)`,
					"prepare-"+fixture.id, "review-"+fixture.id, fixture.id, changedAt); err != nil {
					t.Fatalf("insert canonical review stage event for %s: %v", fixture.id, err)
				}
			}
		}
		stalled, err := postgres.ListOrdersForOperator(ctx, db, "", "operator_review_", "updated_desc", true, 10, "")
		if err != nil || len(stalled.Operations) != 1 || stalled.Operations[0].OrderID != "operator_review_stalled" || stalled.Summary.ActionableCount != 1 {
			t.Fatalf("stalled order must be reviewable without exposing recent or terminal orders: %+v err=%v", stalled, err)
		}
		allReview, err := postgres.ListOrdersForOperator(ctx, db, "", "operator_review_", "updated_desc", false, 10, "")
		if err != nil || len(allReview.Operations) != 3 || allReview.Summary.ActionableCount != 1 {
			t.Fatalf("review counts must use the same eligibility predicate: %+v err=%v", allReview, err)
		}
		// Independent Captain goods custody has a single current operational
		// readback even when the operator requests a one-row page.
		const riskOrder = "operator_custody_risk"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.captain_admissions(id,actor_id,full_name_ar,state,availability_state,requires_profile_review,version) VALUES('operator-risk-admission','operator-risk-captain','كابتن اختبار','eligible','unavailable',false,1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('operator-risk-cart','client_operator_ops','store_operator_ops','checked_out',1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
			id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,
			address_latitude,address_longitude,service_city_id,serviceability_policy_version,
			serviceability_status,serviceability_store_version,serviceability_address_version,
			state,total_amount_minor,payment_cash_amount_minor,currency,version,
			payment_intent_id,payment_method,payment_state,fulfillment_mode)
			VALUES($1,'client_operator_ops','store_operator_ops','operator-risk-cart',
			'operator-risk-address',1,'عنوان اختبار العهدة',15.3694457,44.1910064,
			'sanaa_operator_ops','CITY_SCOPE_V1','SERVICEABLE',1,1,
			'IN_CUSTODY',6400,6400,'YER',1,'operator-risk-payment',
			'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN')`, riskOrder); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(
			id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash)
			VALUES('operator-risk-offer',$1,'operator-risk-captain','accepted',
			clock_timestamp()+interval '1 hour',2,'operator-risk-offer-key','operator-risk-offer-hash')`, riskOrder); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_assignments(
			id,order_id,captain_actor_id,accepted_offer_id,state,version,custody_started_at)
			VALUES('operator-risk-assignment',$1,'operator-risk-captain',
			'operator-risk-offer','in_custody',1,clock_timestamp())`, riskOrder); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_handoffs(
			assignment_id,order_id,store_id,state,version,store_confirmed_at,captain_picked_up_at)
			VALUES('operator-risk-assignment',$1,'store_operator_ops','completed',
			3,clock_timestamp(),clock_timestamp())`, riskOrder); err != nil {
			t.Fatal(err)
		}
		custody, err := postgres.ListOrdersForOperator(ctx, db, "IN_CUSTODY", "", "updated_desc", false, 1, "")
		if err != nil || custody.Summary.InCustodyOrderCount != 1 ||
			custody.Summary.InCustodyOrderValueMinor != 6400 || custody.Summary.TotalCount != 1 {
			t.Fatalf("custody value readback failed: %+v err=%v", custody.Summary, err)
		}
		nonCustody, err := postgres.ListOrdersForOperator(ctx, db, "READY_FOR_DISPATCH", "", "updated_desc", false, 1, "")
		if err != nil || nonCustody.Summary.InCustodyOrderCount != 0 ||
			nonCustody.Summary.InCustodyOrderValueMinor != 0 {
			t.Fatalf("custody leaked across state filter: %+v err=%v", nonCustody.Summary, err)
		}
	})
}
