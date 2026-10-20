package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

// This uses the same collected OrderId used in the DSH Captain delivery
// cross-service test. A reviewed, explicit platform-funded credit is not a
// cancellation or an implicit reversal of the partner's separate earnings.
func verifyCollectedCourierReviewedCompensation(t *testing.T, ctx context.Context, db *sql.DB,
	orderID, intentID, customerID string) {
	t.Helper()
	before, err := postgres.ReadWalletBalance(ctx, db, "customer", customerID)
	if err != nil || before != 0 {
		t.Fatalf("Courier wallet after funding consumption: balance=%d err=%v", before, err)
	}
	input := postgres.OrderAdjustmentReconciliationCaseInput{
		OrderID: orderID, PaymentIntentID: intentID,
		AdjustmentID:   "courier-after-collection-item-adjustment",
		AdjustmentKind: "REMOVE_ITEM", RequestedByActor: customerID,
		CustomerActorID: customerID, ActingActorID: customerID,
		IdempotencyKey: "courier-collected-reconciliation-case",
		CorrelationID:  "courier-collected-reconciliation-correlation",
	}
	review, replay, err := postgres.RecordOrderAdjustmentReconciliationCase(ctx, db, input)
	if err != nil || replay || review.OrderID != orderID {
		t.Fatalf("Cannot open authentic collected-payment review: %+v replay=%t err=%v", review, replay, err)
	}
	credit := postgres.CustomerWalletCompensationInput{
		CaseID: review.ID, AmountMinor: 275,
		ApprovedByActorID: "finance-operator-reviewer",
		EvidenceReference: "approved-courier-adjustment-evidence",
		IdempotencyKey:    "courier-postcollection-credit",
		CorrelationID:     "courier-postcollection-credit-correlation",
	}
	post, replay, err := postgres.CreditReviewedCustomerCompensation(ctx, db, credit)
	if err != nil || replay || post.OrderID != orderID || post.CustomerActorID != customerID ||
		post.AmountMinor != 275 || post.LedgerTransactionID == "" {
		t.Fatalf("Reviewed credit failed: %+v replay=%t err=%v", post, replay, err)
	}
	postAgain, replay, err := postgres.CreditReviewedCustomerCompensation(ctx, db, credit)
	if err != nil || !replay || postAgain.LedgerTransactionID != post.LedgerTransactionID {
		t.Fatalf("Retry created second credit: %+v replay=%t err=%v", postAgain, replay, err)
	}
	differentKey := credit
	differentKey.IdempotencyKey = "courier-postcollection-credit-another-key"
	postByNewKey, replay, err := postgres.CreditReviewedCustomerCompensation(ctx, db, differentKey)
	if err != nil || !replay || postByNewKey.LedgerTransactionID != post.LedgerTransactionID {
		t.Fatalf("Different retry key duplicated reviewed credit: %+v replay=%t err=%v", postByNewKey, replay, err)
	}
	mismatched := credit
	mismatched.AmountMinor = 276
	if _, _, err = postgres.CreditReviewedCustomerCompensation(ctx, db, mismatched); !errors.Is(err, postgres.ErrCustomerWalletCompensationConflict) {
		t.Fatalf("Changed approved credit amount was accepted: %v", err)
	}
	after, err := postgres.ReadWalletBalance(ctx, db, "customer", customerID)
	if err != nil || after != 275 {
		t.Fatalf("Wallet received duplicate/missing credit: before=%d after=%d err=%v", before, after, err)
	}
	history, err := postgres.ListRecentCustomerWalletCompensations(ctx, db, customerID, 10)
	if err != nil || len(history) != 1 || history[0].OrderID != orderID ||
		history[0].AmountMinor != 275 {
		t.Fatalf("Customer-scoped credit history wrong: %+v err=%v", history, err)
	}
	foreign, err := postgres.ListRecentCustomerWalletCompensations(ctx, db, "other-customer", 10)
	if err != nil || len(foreign) != 0 {
		t.Fatalf("Credit history leaked to another actor: %+v err=%v", foreign, err)
	}
	var creditEvents, debit, liability int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM wlt.customer_wallet_compensations WHERE order_id=$1", orderID).Scan(&creditEvents); err != nil || creditEvents != 1 {
		t.Fatalf("Post-collection wallet credit duplicated: %d err=%v", creditEvents, err)
	}
	if err = db.QueryRowContext(ctx, `SELECT
		COALESCE(SUM(amount_minor) FILTER(WHERE account_code='CUSTOMER_COMPENSATION_EXPENSE' AND direction='DEBIT'),0),
		COALESCE(SUM(amount_minor) FILTER(WHERE account_code='CUSTOMER_WALLET' AND direction='CREDIT' AND actor_id=$1),0)
		FROM wlt.ledger_entries WHERE transaction_id=$2`, customerID, post.LedgerTransactionID).
		Scan(&debit, &liability); err != nil || debit != 275 || liability != 275 {
		t.Fatalf("Post-collection credit ledger not balanced: debit=%d liability=%d err=%v", debit, liability, err)
	}
	t.Logf("collected DSH courier OrderId %s -> WLT reviewed wallet credit 275 exactly once; partner earning untouched", orderID)
}
