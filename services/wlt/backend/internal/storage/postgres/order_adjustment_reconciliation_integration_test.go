package postgres

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

// A change to a collected order is not proof that any money is refundable.
// Until a versioned financial policy determines eligibility and amount, WLT
// must persist exactly one unresolved case without posting a wallet credit.
func TestOrderAdjustmentReconciliationPersistsWithoutMovingMoney(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	_, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)

	var orderID, intentID, customerID string
	if err := s.db.QueryRowContext(s.ctx, `SELECT a.order_id,a.payment_intent_id,p.payer_actor_id
		FROM wlt.customer_payment_allocations a JOIN wlt.payment_intents p ON p.id=a.payment_intent_id
		WHERE a.store_id=$1`, store).Scan(&orderID, &intentID, &customerID); err != nil {
		t.Fatalf("read canonical WLT order allocation: %v", err)
	}
	var state string
	if err := s.db.QueryRowContext(s.ctx, "SELECT state FROM wlt.payment_intents WHERE id=$1", intentID).Scan(&state); err != nil || state != "COLLECTED" {
		t.Fatalf("expected collected payment before adjustment: state=%q err=%v", state, err)
	}
	var ledgerBefore, walletBefore int64
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.ledger_entries").Scan(&ledgerBefore); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRowContext(s.ctx, `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0)
		FROM wlt.ledger_entries WHERE account_code='CUSTOMER_WALLET' AND actor_type='customer' AND actor_id=$1`, customerID).Scan(&walletBefore); err != nil {
		t.Fatal(err)
	}

	input := OrderAdjustmentReconciliationCaseInput{
		OrderID: orderID, AdjustmentID: "changed-quantity-" + s.suffix,
		PaymentIntentID: intentID, AdjustmentKind: "SET_ACTUAL_QUANTITY",
		RequestedByActor: customerID, CustomerActorID: customerID, ActingActorID: customerID,
		IdempotencyKey: "adjustment-key-" + s.suffix, CorrelationID: "adjustment-correlation-" + s.suffix,
	}
	if input.ActingActorID == "" {
		t.Fatal("missing actor")
	}
	casesBefore, err := ListOrderAdjustmentReconciliationCases(s.ctx, s.db, orderID, customerID)
	if err != nil || len(casesBefore) != 0 {
		t.Fatalf("unexpected pre-existing cases: %+v err=%v", casesBefore, err)
	}
	wrongPayer := input
	wrongPayer.CustomerActorID, wrongPayer.ActingActorID = "different-customer", "different-customer"
	wrongPayer.IdempotencyKey += "-wrong"
	if _, _, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, wrongPayer); !errors.Is(err, ErrOrderAdjustmentReconciliationConflict) {
		t.Fatalf("another customer must not create an adjustment for someone else's collected payment: %v", err)
	}
	wrongIntent := input
	wrongIntent.PaymentIntentID = "not-an-existing-payment"
	wrongIntent.IdempotencyKey += "-missing"
	if _, _, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, wrongIntent); !errors.Is(err, ErrOrderAdjustmentReconciliationNotFound) {
		t.Fatalf("unowned payment should fail: %v", err)
	}
	mismatchedActor := input
	mismatchedActor.ActingActorID = "unrelated-actor"
	if _, _, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, mismatchedActor); !errors.Is(err, ErrOrderAdjustmentReconciliationInput) {
		t.Fatalf("only canonical customer can request a reconciliation case: %v", err)
	}

	type outcome struct {
		record   OrderAdjustmentReconciliationCase
		replayed bool
		err      error
	}
	start := make(chan struct{})
	done := make(chan outcome, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			record, replayed, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, input)
			done <- outcome{record, replayed, err}
		}()
	}
	close(start)
	wait.Wait()
	close(done)
	var caseID string
	newRecords, retries := 0, 0
	for result := range done {
		if result.err != nil {
			t.Fatalf("concurrent case creation failed: %v", result.err)
		}
		if result.record.State != "RECONCILIATION_REQUIRED" || result.record.ReasonCode != "ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED" {
			t.Fatalf("invalid unresolved case state: %+v", result.record)
		}
		if caseID != "" && result.record.ID != caseID {
			t.Fatalf("duplicate case created for a single DSH adjustment: first=%s next=%s", caseID, result.record.ID)
		}
		caseID = result.record.ID
		if result.replayed {
			retries++
		} else {
			newRecords++
		}
	}
	if newRecords != 1 || retries != 1 {
		t.Fatalf("concurrent outcomes new=%d replay=%d, want 1 each", newRecords, retries)
	}
	changed := input
	changed.AdjustmentKind = "REMOVE_ITEM"
	if _, _, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, changed); !errors.Is(err, ErrOrderAdjustmentReconciliationConflict) {
		t.Fatalf("same key with different adjustment must conflict: %v", err)
	}
	otherKey := input
	otherKey.IdempotencyKey = "retry-new-key-" + s.suffix
	recovered, replayed, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, otherKey)
	if err != nil || !replayed || recovered.ID != caseID {
		t.Fatalf("same Order and adjustment under another key must reuse frozen case: %+v replay=%t err=%v", recovered, replayed, err)
	}
	visible, err := ListOrderAdjustmentReconciliationCases(s.ctx, s.db, orderID, customerID)
	if err != nil || len(visible) != 1 || visible[0].ID != caseID {
		t.Fatalf("customer canonical readback: %+v err=%v", visible, err)
	}
	hidden, err := ListOrderAdjustmentReconciliationCases(s.ctx, s.db, orderID, "different-customer")
	if err != nil || len(hidden) != 0 {
		t.Fatalf("another customer saw a case: %+v err=%v", hidden, err)
	}
	var caseCount int64
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.order_adjustment_reconciliation_cases WHERE order_id=$1 AND adjustment_id=$2", input.OrderID, input.AdjustmentID).Scan(&caseCount); err != nil || caseCount != 1 {
		t.Fatalf("case count=%d err=%v", caseCount, err)
	}
	var ledgerAfter, walletAfter int64
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.ledger_entries").Scan(&ledgerAfter); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRowContext(s.ctx, `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0)
		FROM wlt.ledger_entries WHERE account_code='CUSTOMER_WALLET' AND actor_type='customer' AND actor_id=$1`, customerID).Scan(&walletAfter); err != nil {
		t.Fatal(err)
	}
	if ledgerAfter != ledgerBefore || walletAfter != walletBefore {
		t.Fatal(fmt.Sprintf("an unresolved adjustment created money: ledger entries %d -> %d, customer wallet %d -> %d", ledgerBefore, ledgerAfter, walletBefore, walletAfter))
	}
}
