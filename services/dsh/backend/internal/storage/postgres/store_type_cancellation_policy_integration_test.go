package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Isolated migrated PostgreSQL proof: policy version, immutable Order policy,
// client/Operations cancellation, financial outbox and idempotency.
func TestStoreTypeCancellationPolicyAndLockedOrderTransition(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated cancellation policy test")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 160*time.Second)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		for _, query := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('cancel-proof-city','Test City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('cancel-proof-vertical','Test Vertical','Test Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('cancel-proof-type','cancel-proof-vertical','Test Type','Test Type')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('cancel-proof-store','cancel-proof-partner','Proof Store','cancel-proof-city','cancel-proof-vertical','cancel-proof-type','unpublished',ARRAY['CUSTOMER_PICKUP','BTHWANI_CAPTAIN'])",
		} {
			if _, err := db.ExecContext(ctx, query); err != nil {
				t.Fatalf("seed isolated registry: %v", err)
			}
		}
		typePolicy, err := postgres.ReadCommercialStoreType(ctx, db, "cancel-proof-type")
		if err != nil || typePolicy.CancellationMode != "OPERATIONS_ONLY" || typePolicy.Version != 1 {
			t.Fatalf("default must fail closed: %+v %v", typePolicy, err)
		}
		saveOrder := func(suffix, mode, paymentState string, policyVersion int) string {
			t.Helper()
			id := "cancel-proof-order-" + suffix
			cart := "cancel-proof-cart-" + suffix
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'cancel-proof-client','cancel-proof-store','checked_out',1)", cart); err != nil {
				t.Fatal(err)
			}
			_, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
				id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,state,
				total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,
				fulfillment_mode,payment_cash_amount_minor,cancellation_mode,cancellation_policy_version)
				VALUES($1,'cancel-proof-client','cancel-proof-store',$2,'cancel-proof-city',1,'CREATED',
				1500,'YER',1,$3,'CASH_AT_STORE',$4,'CUSTOMER_PICKUP',300,$5,$6)`,
				id, cart, "cancel-proof-intent-"+suffix, paymentState, mode, policyVersion)
			if err != nil {
				t.Fatal(err)
			}
			return id
		}
		restricted := saveOrder("old", "OPERATIONS_ONLY", "REQUIRES_COLLECTION", 1)
		updated, replay, err := postgres.UpdateStoreTypeCancellationMode(ctx, db, "cancel-proof-type",
			"CLIENT_BEFORE_ACCEPTANCE", "Allow safe early cancellation", "operator-policy-editor",
			"cancel-proof-update-key", "cancel-proof-update-correlation", 1)
		if err != nil || replay || updated.Version != 2 || updated.CancellationMode != "CLIENT_BEFORE_ACCEPTANCE" {
			t.Fatalf("policy mutation: %+v replay=%t err=%v", updated, replay, err)
		}
		if _, replay, err = postgres.UpdateStoreTypeCancellationMode(ctx, db, "cancel-proof-type",
			"CLIENT_BEFORE_ACCEPTANCE", "Allow safe early cancellation", "operator-policy-editor",
			"cancel-proof-update-key", "cancel-proof-update-correlation", 1); err != nil || !replay {
			t.Fatalf("policy replay: replay=%t err=%v", replay, err)
		}
		if _, _, err := postgres.UpdateStoreTypeCancellationMode(ctx, db, "cancel-proof-type",
			"OPERATIONS_ONLY", "Changed decision", "operator-policy-editor", "cancel-proof-update-key",
			"cancel-proof-update-correlation", 1); !errors.Is(err, postgres.ErrCancellationPolicyConflict) {
			t.Fatalf("conflicting policy replay accepted: %v", err)
		}
		for _, entry := range []string{restricted} {
			order, err := postgres.ReadOrder(ctx, db, entry)
			if err != nil || order.CancellationMode != "OPERATIONS_ONLY" || order.CancellationPolicyVersion != 1 {
				t.Fatalf("policy retroactively changed old Order: %+v %v", order, err)
			}
		}
		eligible := saveOrder("eligible", "CLIENT_BEFORE_ACCEPTANCE", "REQUIRES_COLLECTION", 2)
		accepted := saveOrder("accepted", "CLIENT_BEFORE_ACCEPTANCE", "REQUIRES_COLLECTION", 2)
		collected := saveOrder("collected", "CLIENT_BEFORE_ACCEPTANCE", "COLLECTED", 2)
		transition := func(id, target, reason, key string, version int) (postgres.OrderRecord, bool, error) {
			return postgres.TransitionOrderWithPaymentCancellation(ctx, db, id, target, version, key,
				postgres.HashOrderTransition(id, target, version), "cancel-proof-client", "cancel-proof-correlation", reason)
		}
		if _, _, err := transition(restricted, "CANCELLED", "client_cancelled", "cancel-proof-restricted-key", 1); !errors.Is(err, postgres.ErrOrderStateConflict) {
			t.Fatalf("Operations-only Order accepted self cancellation: %v", err)
		}
		if _, _, err := transition(collected, "CANCELLED", "client_cancelled", "cancel-proof-collected-key", 1); !errors.Is(err, postgres.ErrOrderStateConflict) {
			t.Fatalf("collected Order accepted self cancellation: %v", err)
		}
		if _, _, err := postgres.TransitionOrder(ctx, db, accepted, "PARTNER_ACCEPTED", "", 1,
			"cancel-proof-accepted-key", postgres.HashOrderTransition(accepted, "PARTNER_ACCEPTED", 1),
			"cancel-proof-partner", "cancel-proof-correlation"); err != nil {
			t.Fatal(err)
		}
		if _, _, err := transition(accepted, "CANCELLED", "client_cancelled", "cancel-proof-afteraccept-key", 2); !errors.Is(err, postgres.ErrOrderStateConflict) {
			t.Fatalf("accepted Order could be self-cancelled: %v", err)
		}
		if _, _, err := postgres.CancelOrderForOperator(ctx, db, accepted, 2,
			"cancel-proof-no-review-key", "cancel-proof-operator", "cancel-proof-operator-correlation",
			"Store confirmation missing for accepted Order", false); !errors.Is(err, postgres.ErrOrderStateConflict) {
			t.Fatalf("accepted Order cancelled by operator without reviewed Store: %v", err)
		}
		afterReview, _, err := postgres.CancelOrderForOperator(ctx, db, accepted, 2,
			"cancel-proof-reviewed-key", "cancel-proof-operator", "cancel-proof-operator-correlation",
			"Store confirms no preparation cost after explicit review", true)
		if err != nil || afterReview.State != "CANCELLED" {
			t.Fatalf("reviewed accepted Order cancellation: %+v %v", afterReview, err)
		}
		item, replay, err := transition(eligible, "CANCELLED", "client_cancelled", "cancel-proof-client-cancel-key", 1)
		if err != nil || replay || item.State != "CANCELLED" {
			t.Fatalf("eligible client cancelled: %+v %t %v", item, replay, err)
		}
		_, replay, err = transition(eligible, "CANCELLED", "client_cancelled", "cancel-proof-client-cancel-key", 1)
		if err != nil || !replay {
			t.Fatalf("cancel replay: %t %v", replay, err)
		}
		operated, replay, err := postgres.CancelOrderForOperator(ctx, db, restricted, 1,
			"cancel-proof-operator-key", "cancel-proof-operator", "cancel-proof-operator-correlation",
			"Partner confirmed that preparation has not started", false)
		if err != nil || replay || operated.State != "CANCELLED" {
			t.Fatalf("operator cancellation: %+v %t %v", operated, replay, err)
		}
		_, replay, err = postgres.CancelOrderForOperator(ctx, db, restricted, 1,
			"cancel-proof-operator-key", "cancel-proof-operator", "cancel-proof-operator-correlation",
			"Partner confirmed that preparation has not started", false)
		if err != nil || !replay {
			t.Fatalf("operator replay: %t %v", replay, err)
		}
		reviewedOrder := saveOrder("support-reviewed", "OPERATIONS_ONLY", "REQUIRES_COLLECTION", 1)
		first, replayed, err := postgres.CreateCancellationRequest(ctx, db, reviewedOrder, "cancel-proof-client",
			"Please review my request to cancel this Store order", "support-first-attempt", "support-first-correlation")
		if err != nil || replayed || first.State != "PENDING" {
			t.Fatalf("support intake: %+v %t %v", first, replayed, err)
		}
		_, replayed, err = postgres.CreateCancellationRequest(ctx, db, reviewedOrder, "cancel-proof-client",
			"Please review my request to cancel this Store order", "support-first-attempt", "support-first-correlation")
		if err != nil || !replayed {
			t.Fatalf("support replay: %t %v", replayed, err)
		}
		if _, _, err = postgres.CreateCancellationRequest(ctx, db, reviewedOrder, "foreign-client",
			"Please review another customer's Order cancellation", "support-foreign-attempt", "support-foreign-correlation"); !errors.Is(err, postgres.ErrCancellationRequestNotFound) {
			t.Fatalf("foreign actor access: %v", err)
		}
		if _, _, err = postgres.CreateCancellationRequest(ctx, db, reviewedOrder, "cancel-proof-client",
			"Second request must not duplicate the outstanding ticket", "support-second-attempt", "support-second-correlation"); !errors.Is(err, postgres.ErrCancellationRequestConflict) {
			t.Fatalf("duplicate pending request: %v", err)
		}
		if _, err = postgres.ReadClientCancellationRequest(ctx, db, reviewedOrder, "foreign-client"); !errors.Is(err, postgres.ErrCancellationRequestNotFound) {
			t.Fatalf("foreign actor read: %v", err)
		}
		queue, err := postgres.ListPendingCancellationRequests(ctx, db, 10)
		if err != nil || len(queue) != 1 || queue[0].OrderID != reviewedOrder {
			t.Fatalf("operations intake queue: %+v %v", queue, err)
		}
		declined, err := postgres.DeclineCancellationRequest(ctx, db, first.ID, "cancel-proof-operator",
			"Store has already committed to a custom preparation cost")
		if err != nil || declined.State != "DECLINED" {
			t.Fatalf("operator decline: %+v %v", declined, err)
		}
		second, _, err := postgres.CreateCancellationRequest(ctx, db, reviewedOrder, "cancel-proof-client",
			"Please reconsider my cancellation with the Store", "support-reconsider-attempt", "support-reconsider-correlation")
		if err != nil || second.State != "PENDING" {
			t.Fatalf("support reconsideration: %+v %v", second, err)
		}
		reviewedResult, _, err := postgres.CancelOrderForOperator(ctx, db, reviewedOrder, 1,
			"support-operator-cancel", "cancel-proof-operator", "support-operator-correlation",
			"Store confirmed no preparation had begun and cancellation is approved", false)
		if err != nil || reviewedResult.State != "CANCELLED" {
			t.Fatalf("operator decision: %+v %v", reviewedResult, err)
		}
		last, err := postgres.ReadClientCancellationRequest(ctx, db, reviewedOrder, "cancel-proof-client")
		if err != nil || last.State != "APPROVED" || last.OperatorActorID == nil {
			t.Fatalf("client cannot read accepted decision: %+v %v", last, err)
		}
		queue, err = postgres.ListPendingCancellationRequests(ctx, db, 10)
		if err != nil || len(queue) != 0 {
			t.Fatalf("approved support still pending: %+v %v", queue, err)
		}
		var outbox, changes, audit int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_financial_handoff_outbox WHERE effect_type='PAYMENT_CANCEL'").Scan(&outbox); err != nil || outbox != 4 {
			t.Fatalf("outbox=%d err=%v", outbox, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_type_cancellation_policy_audit").Scan(&changes); err != nil || changes != 1 {
			t.Fatalf("policy audit=%d err=%v", changes, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_order_audit WHERE order_id=$1 AND acting_actor_id='cancel-proof-operator' AND decision_reason LIKE 'Partner confirmed%'", restricted).Scan(&audit); err != nil || audit != 1 {
			t.Fatalf("reason missing=%d err=%v", audit, err)
		}
	})
}
