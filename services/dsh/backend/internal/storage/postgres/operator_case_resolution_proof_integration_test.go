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

func TestOperatorCaseSensitiveResolutionRequiresOwnerProof(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated DSH PostgreSQL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('ops_evidence_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "ops_evidence_store", PartnerActorID: "ops_evidence_partner", Name: "Evidence Store"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('ops_evidence_cart','ops_evidence_client','ops_evidence_store','checked_out',1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
   (id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
   service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,
   state,total_amount_minor,payment_cash_amount_minor,currency,version)
   VALUES('ops_evidence_order','ops_evidence_client','ops_evidence_store','ops_evidence_cart',
   'ops_evidence_address',1,'Sanaa',15.37,44.19,'ops_evidence_city','CITY_SCOPE_V1','SERVICEABLE',1,1,
   'READY_FOR_DISPATCH',1100,1100,'YER',1)`); err != nil {
			t.Fatal(err)
		}
		// These fixtures simulate acknowledged or pending DSH->WLT outbox states.
		// They do not claim to exercise a real WLT ledger.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_orders
    SET payment_intent_id='evidence-payment-intent',payment_state='CANCELLED'
    WHERE id='ops_evidence_order'`); err != nil {
			t.Fatal(err)
		}
		payment, _, err := postgres.OpenOpsCase(ctx, db, "ops_evidence_order", "ops_evidence_operator",
			"PAYMENT_EXCEPTION", "URGENT", "Confirm posted cancellation or adjustment from WLT",
			"case-evidence-open-payment", "case-evidence-correlation")
		if err != nil {
			t.Fatal(err)
		}
		claimed, _, err := postgres.UpdateOpsCase(ctx, db, payment.OrderID, payment.ID, "ops_evidence_operator",
			"CLAIM", "", "case-evidence-claim-payment", "case-evidence-claim-corr", 1)
		if err != nil || claimed.Version != 2 {
			t.Fatalf("claim: %+v %v", claimed, err)
		}
		closeCase := func(key, ref string) error {
			_, _, closeErr := postgres.UpdateOpsCase(ctx, db, payment.OrderID, payment.ID, "ops_evidence_operator",
				"RESOLVE", "Reviewed the actual provider acknowledgement",
				key, "case-evidence-close-corr", 2, ref)
			return closeErr
		}
		if err := closeCase("case-evidence-no-proof", ""); !errors.Is(err, postgres.ErrOpsCaseUnverified) {
			t.Fatalf("empty WLT receipt accepted: %v", err)
		}
		if err := closeCase("case-evidence-fake-proof", "financial_handoff:fake"); !errors.Is(err, postgres.ErrOpsCaseUnverified) {
			t.Fatalf("fake WLT receipt accepted: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_financial_handoff_outbox
      (id,effect_type,source_ref,order_id,payment_intent_id,amount_minor,reason,idempotency_key,correlation_id,state,acting_actor_id)
      VALUES('case-evidence-handoff','PAYMENT_CANCEL','case-evidence-source','ops_evidence_order',
      'evidence-payment-intent',1100,'operator cancellation','case-evidence-wlt-key','case-evidence-wlt-corr','PENDING','ops_evidence_operator')`); err != nil {
			t.Fatal(err)
		}
		pendingChoices, err := postgres.ListOrderCaseResolutionEvidence(ctx, db, "ops_evidence_order", payment.ID)
		if err != nil || len(pendingChoices) != 0 {
			t.Fatalf("pending proof leaked into picker: %+v %v", pendingChoices, err)
		}
		if err := closeCase("case-evidence-pending-proof", "financial_handoff:case-evidence-handoff"); !errors.Is(err, postgres.ErrOpsCaseUnverified) {
			t.Fatalf("pending WLT claim accepted: %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.commerce_financial_handoff_outbox
    SET state='POSTED' WHERE id='case-evidence-handoff'`); err != nil {
			t.Fatal(err)
		}
		choices, err := postgres.ListOrderCaseResolutionEvidence(ctx, db, "ops_evidence_order", payment.ID)
		if err != nil || len(choices) != 1 || choices[0].Reference != "financial_handoff:case-evidence-handoff" ||
			choices[0].Kind != "PAYMENT_CANCEL" {
			t.Fatalf("posted financial reference not discoverable: %+v %v", choices, err)
		}
		if _, err := postgres.ListOrderCaseResolutionEvidence(ctx, db, "other-order", payment.ID); !errors.Is(err, postgres.ErrOpsCaseNotFound) {
			t.Fatalf("cross-order proof discovery exposed: %v", err)
		}
		finished, replay, err := postgres.UpdateOpsCase(ctx, db, payment.OrderID, payment.ID, "ops_evidence_operator",
			"RESOLVE", "Reviewed the actual provider acknowledgement", "case-evidence-posted-proof",
			"case-evidence-close-corr", 2, "financial_handoff:case-evidence-handoff")
		if err != nil || replay || finished.State != "RESOLVED" || finished.ResolutionEvidenceRef == nil ||
			*finished.ResolutionEvidenceRef != "financial_handoff:case-evidence-handoff" {
			t.Fatalf("posted proof not durably recorded: %+v replay=%v err=%v", finished, replay, err)
		}
		afterClosure, err := postgres.ListOrderCaseResolutionEvidence(ctx, db, "ops_evidence_order", payment.ID)
		if err != nil || len(afterClosure) != 0 {
			t.Fatalf("resolved proof still offered for action: %+v %v", afterClosure, err)
		}
		again, replay, err := postgres.UpdateOpsCase(ctx, db, payment.OrderID, payment.ID, "ops_evidence_operator",
			"RESOLVE", "Reviewed the actual provider acknowledgement", "case-evidence-posted-proof",
			"case-evidence-close-corr", 2, "financial_handoff:case-evidence-handoff")
		if err != nil || !replay || again.ID != payment.ID {
			t.Fatalf("idempotent replay failed: %+v %v", again, err)
		}
		goods, _, err := postgres.OpenOpsCase(ctx, db, "ops_evidence_order", "ops_evidence_operator",
			"DELIVERY_BLOCKED", "URGENT", "Review captain custody and physical delivery evidence",
			"case-evidence-open-goods", "case-evidence-goodscorr")
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, goods.OrderID, goods.ID, "ops_evidence_operator",
			"CLAIM", "", "case-evidence-claim-goods", "case-evidence-claim-goods-corr", 1)
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, goods.OrderID, goods.ID, "ops_evidence_operator",
			"RESOLVE", "Delivered, according to the human operator", "case-evidence-fake-delivery",
			"case-evidence-fake-delivery-corr", 2, "delivery_completed:123")
		if !errors.Is(err, postgres.ErrOpsCaseUnverified) {
			t.Fatalf("unverified goods custody falsely closed: %v", err)
		}
		goodsChoices, err := postgres.ListOrderCaseResolutionEvidence(ctx, db, "ops_evidence_order", goods.ID)
		if err != nil || len(goodsChoices) != 0 {
			t.Fatalf("unverified goods proof was suggested: %+v %v", goodsChoices, err)
		}
		actual, err := postgres.ReadOpsCase(ctx, db, goods.ID)
		if err != nil || actual.State == "RESOLVED" {
			t.Fatalf("goods case closed without proof: %+v %v", actual, err)
		}
	})
}
