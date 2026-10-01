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
	_ "github.com/lib/pq"
)

func TestCaptainCompletionReplaysAfterOrderTransitions(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for Captain completion replay proof")
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
		keys := testDeliveryProofKeyring(t)
		if err := postgres.Migrate(ctx, db, records, migrationSQL, keys); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		const (
			orderID         = "captain-replay-order"
			cartID          = "captain-replay-cart"
			storeID         = "captain-replay-store"
			cityID          = "captain-replay-city"
			captainActorID  = "captain-replay-actor"
			offerID         = "captain-replay-offer"
			assignmentID    = "captain-replay-assignment"
			paymentIntentID = "captain-replay-payment"
			idempotencyKey  = "captain-replay-completion-key"
			correlationID   = "captain-replay-completion-correlation"
			proofCode       = "123456"
		)
		now := time.Now().UTC()
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة اختبار الكابتن"); err != nil {
			t.Fatalf("insert service city: %v", err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: "captain-replay-partner", Name: "متجر اختبار الكابتن"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cartID, "captain-replay-client", storeID); err != nil {
			t.Fatalf("insert cart: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
			VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,'IN_CUSTODY',1800,'YER',1,$8,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, orderID, "captain-replay-client", storeID, cartID, "captain-replay-address", "عنوان اختبار التسليم", cityID, paymentIntentID); err != nil {
			t.Fatalf("insert order: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash)
			VALUES($1,$2,$3,'accepted',$4,2,$5,'captain-replay-offer-hash')`, offerID, orderID, captainActorID, now.Add(time.Hour), "captain-replay-offer-key"); err != nil {
			t.Fatalf("insert accepted dispatch offer: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_assignments(id,order_id,captain_actor_id,accepted_offer_id,state,version,custody_started_at)
			VALUES($1,$2,$3,$4,'in_custody',1,$5)`, assignmentID, orderID, captainActorID, offerID, now); err != nil {
			t.Fatalf("insert Captain assignment: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_handoffs(assignment_id,order_id,store_id,state,version,store_confirmed_at,captain_picked_up_at)
			VALUES($1,$2,$3,'completed',3,$4,$4)`, assignmentID, orderID, storeID, now); err != nil {
			t.Fatalf("insert completed store handoff: %v", err)
		}
		proofKeyID, proofCiphertext, err := keys.Encrypt(orderID, proofCode)
		if err != nil {
			t.Fatalf("encrypt delivery proof: %v", err)
		}
		proofVerifier, err := keys.ProofVerifier(orderID, proofKeyID, proofCode)
		if err != nil {
			t.Fatalf("create delivery proof verifier: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_delivery_proofs(order_id,client_actor_id,code_ciphertext,code_verifier,code_key_id,state)
			VALUES($1,$2,$3,$4,$5,'PENDING')`, orderID, "captain-replay-client", proofCiphertext, proofVerifier, proofKeyID); err != nil {
			t.Fatalf("insert pending delivery proof: %v", err)
		}

		first, replayed, err := postgres.CompleteCaptainAssignment(ctx, db, assignmentID, captainActorID, "delivered", 1800, proofCode, 1, idempotencyKey, correlationID, keys)
		if err != nil || replayed || first.State != "delivered" || first.Version != 2 {
			t.Fatalf("first Captain completion = %+v replayed=%t err=%v", first, replayed, err)
		}
		second, replayed, err := postgres.CompleteCaptainAssignment(ctx, db, assignmentID, captainActorID, "delivered", 1800, proofCode, 1, idempotencyKey, correlationID, keys)
		if err != nil || !replayed || second.State != "delivered" || second.Version != first.Version {
			t.Fatalf("same-key replay after order/payment transition = %+v replayed=%t err=%v", second, replayed, err)
		}
		if _, _, err := postgres.CompleteCaptainAssignment(ctx, db, assignmentID, captainActorID, "delivered", 1799, proofCode, 1, idempotencyKey, correlationID, keys); !errors.Is(err, postgres.ErrCaptainOperationConflict) {
			t.Fatalf("same key with changed collection amount = %v; want idempotency conflict", err)
		}

		var orderState string
		var outboxCount, auditCount int
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.commerce_orders WHERE id=$1", orderID).Scan(&orderState); err != nil || orderState != "DELIVERED" {
			t.Fatalf("canonical order state = %q, %v; want DELIVERED", orderState, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_financial_handoff_outbox WHERE idempotency_key=$1", idempotencyKey).Scan(&outboxCount); err != nil || outboxCount != 1 {
			t.Fatalf("financial handoff rows = %d, %v; want one", outboxCount, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.captain_audit WHERE idempotency_key=$1 AND event_type='delivery_completed'", idempotencyKey).Scan(&auditCount); err != nil || auditCount != 1 {
			t.Fatalf("completion audit rows = %d, %v; want one", auditCount, err)
		}
	})
}
