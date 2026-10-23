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

func TestOperatorContactReviewThreeVerifiedSuccessesAndReplay(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL required for isolated Postgres contact verification proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('contact_sanaa','صنعاء',true)`); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "contact_store", PartnerActorID: "contact_partner", Name: "متجر الاتصال"})
		for i := 1; i <= 4; i++ {
			orderID := fmt.Sprintf("contact_order_%d", i)
			cartID := "cart_" + orderID
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'contact_customer','contact_store','checked_out',1)", cartID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version)
              VALUES($1,'contact_customer','contact_store',$2,$3,1,'عنوان العميل',15.369445,44.191006,'contact_sanaa','CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,1800,'YER',1)`, orderID, cartID, "address_"+orderID); err != nil {
				t.Fatal(err)
			}
		}
		pendingFirst, err := postgres.ListPendingCustomerContacts(ctx, db, 2, "")
		if err != nil || len(pendingFirst.Items) != 2 || pendingFirst.NextCursor == "" {
			t.Fatalf("first contact queue page: %+v err=%v", pendingFirst, err)
		}
		pendingNext, err := postgres.ListPendingCustomerContacts(ctx, db, 2, pendingFirst.NextCursor)
		if err != nil || len(pendingNext.Items) != 2 || pendingNext.NextCursor != "" {
			t.Fatalf("second contact queue page: %+v err=%v", pendingNext, err)
		}
		if _, err := postgres.ListPendingCustomerContacts(ctx, db, 10, "invalid-cursor"); !errors.Is(err, postgres.ErrCustomerContactInvalid) {
			t.Fatalf("malformed cursor accepted: %v", err)
		}
		initial, err := postgres.ReadCustomerOrderContactReview(ctx, db, "contact_order_1")
		if err != nil || initial.State != "PENDING" || !initial.NeedsContact || initial.Trusted || initial.VerifiedSuccessfulOrders != 0 {
			t.Fatalf("initial contact: %+v err=%v", initial, err)
		}
		_, _, err = postgres.RecordCustomerOrderContactDecision(ctx, db, "contact_order_1", "ops_a", "NO_ANSWER", "contact-unclaimed-1", "contact-corr-1", 0)
		if !errors.Is(err, postgres.ErrCustomerContactConflict) {
			t.Fatalf("decision without claim was accepted: %v", err)
		}
		claim, err := postgres.UpdateCustomerContactClaim(ctx, db, "contact_order_1", "ops_a", false, 0)
		if err != nil || !claim.ClaimedByMe || claim.State != "PENDING" {
			t.Fatalf("claim not owned: %+v err=%v", claim, err)
		}
		blocked, err := postgres.ReadCustomerOrderContactReview(ctx, db, "contact_order_1", "ops_b")
		if err != nil || !blocked.ClaimedByOther {
			t.Fatalf("other operator claim hidden: %+v err=%v", blocked, err)
		}
		_, err = postgres.UpdateCustomerContactClaim(ctx, db, "contact_order_1", "ops_b", false, 0)
		if !errors.Is(err, postgres.ErrCustomerContactConflict) {
			t.Fatalf("double claim accepted: %v", err)
		}
		first, replay, err := postgres.RecordCustomerOrderContactDecision(ctx, db, "contact_order_1", "ops_a", "NO_ANSWER", "contact-no-answer-1", "contact-corr-1", 0)
		if err != nil || replay || first.AttemptCount != 1 || first.Version != 1 {
			t.Fatalf("no answer: %+v replay=%v err=%v", first, replay, err)
		}
		old, replay, err := postgres.RecordCustomerOrderContactDecision(ctx, db, "contact_order_1", "ops_a", "NO_ANSWER", "contact-no-answer-1", "contact-corr-1", 0)
		if err != nil || !replay || old.AttemptCount != 1 {
			t.Fatalf("idempotent replay: %+v replay=%v err=%v", old, replay, err)
		}
		_, _, err = postgres.RecordCustomerOrderContactDecision(ctx, db, "contact_order_1", "ops_a", "CONFIRMED", "contact-no-answer-1", "contact-corr-1", 1)
		if !errors.Is(err, postgres.ErrCustomerContactIdempotency) {
			t.Fatalf("mismatched replay was accepted: %v", err)
		}
		_, _, err = postgres.RecordCustomerOrderContactDecision(ctx, db, "contact_order_1", "ops_b", "CONFIRMED", "contact-stale-1", "contact-corr-1", 0)
		if !errors.Is(err, postgres.ErrCustomerContactConflict) {
			t.Fatalf("stale write accepted: %v", err)
		}
		// Concurrent callers compete for one claim, and an abandoned lease expires.
		results := make(chan error, 2)
		for _, actor := range []string{"ops_a", "ops_b"} {
			go func(owner string) {
				_, err := postgres.UpdateCustomerContactClaim(ctx, db, "contact_order_4", owner, false, 0)
				results <- err
			}(actor)
		}
		one, two := <-results, <-results
		if (one == nil) == (two == nil) {
			t.Fatalf("two concurrent claimants both won or both lost: %v %v", one, two)
		}
		var winner string
		var claimedBy sql.NullString
		if err := db.QueryRowContext(ctx, "SELECT claim_actor_id FROM dsh.customer_order_contact_reviews WHERE order_id='contact_order_4'").Scan(&claimedBy); err != nil {
			t.Fatal(err)
		}
		winner = claimedBy.String
		if _, err := db.ExecContext(ctx, "UPDATE dsh.customer_order_contact_reviews SET claim_expires_at=clock_timestamp()-interval '1 minute' WHERE order_id='contact_order_4'"); err != nil {
			t.Fatal(err)
		}
		other := "ops_a"
		if winner == "ops_a" {
			other = "ops_b"
		}
		taken, err := postgres.UpdateCustomerContactClaim(ctx, db, "contact_order_4", other, false, 0)
		if err != nil || !taken.ClaimedByMe {
			t.Fatalf("expired lease cannot be taken: %+v %v", taken, err)
		}
		_, err = postgres.UpdateCustomerContactClaim(ctx, db, "contact_order_4", winner, true, 0)
		if !errors.Is(err, postgres.ErrCustomerContactConflict) {
			t.Fatalf("former owner released new owner: %v", err)
		}
		released, err := postgres.UpdateCustomerContactClaim(ctx, db, "contact_order_4", other, true, 0)
		if err != nil || released.ClaimedByMe || released.ClaimedByOther {
			t.Fatalf("release did not clear claim: %+v err=%v", released, err)
		}
		for i := 1; i <= 3; i++ {
			orderID := fmt.Sprintf("contact_order_%d", i)
			version := 0
			if i == 1 {
				version = 1
			}
			claimed, claimErr := postgres.UpdateCustomerContactClaim(ctx, db, orderID, "ops_a", false, version)
			if claimErr != nil || !claimed.ClaimedByMe {
				t.Fatalf("operator could not claim next contact: %+v err=%v", claimed, claimErr)
			}
			reviewed, replay, err := postgres.RecordCustomerOrderContactDecision(ctx, db, orderID, "ops_a", "CONFIRMED", fmt.Sprintf("contact-confirm-%d", i), fmt.Sprintf("contact-correlation-%d", i), version)
			if err != nil || replay || reviewed.State != "CONFIRMED" || reviewed.VerifiedSuccessfulOrders != i-1 {
				t.Fatalf("confirm before delivery %d: %+v err=%v", i, reviewed, err)
			}
			if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='DELIVERED',version=version+1 WHERE id=$1", orderID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,to_state,result_version,request_hash,created_at)
            VALUES('delivery_completed',$1,$2,'contact_captain',$3,'delivered',2,'contact-delivery-proof',clock_timestamp())`, fmt.Sprintf("contact-delivery-%d", i), fmt.Sprintf("delivery-corr-%d", i), orderID); err != nil {
				t.Fatal(err)
			}
			done, err := postgres.ReadCustomerOrderContactReview(ctx, db, orderID)
			if err != nil || done.VerifiedSuccessfulOrders != i || done.Trusted != (i == 3) {
				t.Fatalf("verified completion %d: %+v err=%v", i, done, err)
			}
		}
		finishedQueue, err := postgres.ListPendingCustomerContacts(ctx, db, 10, "")
		if err != nil || len(finishedQueue.Items) != 0 {
			t.Fatalf("trusted and completed orders still require contact: %+v err=%v", finishedQueue, err)
		}
		fourth, err := postgres.ReadCustomerOrderContactReview(ctx, db, "contact_order_4")
		if err != nil || !fourth.Trusted || fourth.NeedsContact || fourth.State != "PENDING" {
			t.Fatalf("fourth active order must automatically waive routine contact: %+v err=%v", fourth, err)
		}
		trusted, err := postgres.ReadCustomerOrderContactReview(ctx, db, "contact_order_1")
		if err != nil || !trusted.Trusted || trusted.LegacyExempt {
			t.Fatalf("3 confirmed completions not trusted: %+v err=%v", trusted, err)
		}
		var events int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.customer_order_contact_events WHERE order_id='contact_order_1'").Scan(&events); err != nil || events != 2 {
			t.Fatalf("audit events=%d err=%v", events, err)
		}
	})
}
