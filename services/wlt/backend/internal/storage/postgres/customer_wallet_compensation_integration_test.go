package postgres

import (
	"errors"
	"sync"
	"testing"
)

func TestReviewedCustomerWalletCompensationUsesExistingCaseAndBalancedLedger(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	_, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	var orderID, intentID, customerID string
	if err := s.db.QueryRowContext(s.ctx, `SELECT allocation.order_id,allocation.payment_intent_id,intent.payer_actor_id
  FROM wlt.customer_payment_allocations allocation JOIN wlt.payment_intents intent ON intent.id=allocation.payment_intent_id
  WHERE allocation.store_id=$1`, store).Scan(&orderID, &intentID, &customerID); err != nil {
		t.Fatal(err)
	}
	var payable int64
	if err := s.db.QueryRowContext(s.ctx, `SELECT customer_payable_minor FROM wlt.customer_payment_allocations WHERE payment_intent_id=$1`, intentID).Scan(&payable); err != nil {
		t.Fatal(err)
	}
	if payable < 2 {
		t.Fatalf("fixture payable too low: %d", payable)
	}
	caseInput := OrderAdjustmentReconciliationCaseInput{OrderID: orderID, AdjustmentID: "case-credit-" + s.suffix,
		PaymentIntentID: intentID, AdjustmentKind: "REMOVE_ITEM", RequestedByActor: customerID,
		CustomerActorID: customerID, ActingActorID: customerID,
		IdempotencyKey: "create-comp-case-" + s.suffix, CorrelationID: "case-correlation-" + s.suffix}
	adjustment, _, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, caseInput)
	if err != nil {
		t.Fatal(err)
	}
	walletBefore, err := readCustomerWalletState(s.ctx, s.db, customerID)
	if err != nil {
		t.Fatal(err)
	}
	credit := CustomerWalletCompensationInput{CaseID: adjustment.ID, AmountMinor: 1, ApprovedByActorID: "operator-finance-" + s.suffix,
		EvidenceReference: "dsh-order-adjustment-" + caseInput.AdjustmentID,
		IdempotencyKey:    "wallet-compensation-" + s.suffix, CorrelationID: "wallet-compensation-correlation-" + s.suffix}
	type outcome struct {
		item     CustomerWalletCompensationRecord
		replayed bool
		err      error
	}
	results := make(chan outcome, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			item, replay, err := CreditReviewedCustomerCompensation(s.ctx, s.db, credit)
			results <- outcome{item, replay, err}
		}()
	}
	wg.Wait()
	close(results)
	newCount, replayCount := 0, 0
	for res := range results {
		if res.err != nil {
			t.Fatalf("concurrent credit failed: %v", res.err)
		}
		if res.item.CaseID != adjustment.ID || res.item.AmountMinor != 1 || res.item.CustomerActorID != customerID {
			t.Fatalf("invalid readback: %+v", res.item)
		}
		if res.replayed {
			replayCount++
		} else {
			newCount++
		}
	}
	if newCount != 1 || replayCount != 1 {
		t.Fatalf("new=%d replay=%d, want one each", newCount, replayCount)
	}
	cases, err := ListOrderAdjustmentReconciliationCases(s.ctx, s.db, orderID, customerID)
	if err != nil || len(cases) != 1 || cases[0].ID != adjustment.ID || cases[0].State != "COMPENSATED" {
		t.Fatalf("posted compensation must close review case: %+v %v", cases, err)
	}
	caseReplay, replayedCase, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, caseInput)
	if err != nil || !replayedCase || caseReplay.State != "COMPENSATED" {
		t.Fatalf("committed case must replay as resolved: %+v replay=%t err=%v", caseReplay, replayedCase, err)
	}
	walletAfter, err := readCustomerWalletState(s.ctx, s.db, customerID)
	if err != nil {
		t.Fatal(err)
	}
	if walletAfter.LedgerBalanceMinor != walletBefore.LedgerBalanceMinor+1 || walletAfter.AvailableMinor != walletBefore.AvailableMinor+1 {
		t.Fatalf("wallet balance not credited exactly once: before=%+v after=%+v", walletBefore, walletAfter)
	}
	history, err := ListRecentCustomerWalletCompensations(s.ctx, s.db, customerID, 10)
	if err != nil || len(history) != 1 || history[0].CaseID != adjustment.ID || history[0].OrderID != orderID ||
		history[0].LedgerTransactionID == "" || history[0].AmountMinor != 1 {
		t.Fatalf("canonical customer wallet history not readable: entries=%+v err=%v", history, err)
	}
	foreignHistory, err := ListRecentCustomerWalletCompensations(s.ctx, s.db, "foreign-"+customerID, 10)
	if err != nil || len(foreignHistory) != 0 {
		t.Fatalf("customer wallet history leaked to another actor: %+v err=%v", foreignHistory, err)
	}
	var debit, liability int64
	if err := s.db.QueryRowContext(s.ctx, `SELECT
  COALESCE(SUM(amount_minor) FILTER(WHERE account_code='CUSTOMER_COMPENSATION_EXPENSE' AND direction='DEBIT'),0),
  COALESCE(SUM(amount_minor) FILTER(WHERE account_code='CUSTOMER_WALLET' AND direction='CREDIT' AND actor_id=$1),0)
  FROM wlt.ledger_entries WHERE transaction_id=(SELECT ledger_transaction_id FROM wlt.customer_wallet_compensations WHERE case_id=$2)`, customerID, adjustment.ID).Scan(&debit, &liability); err != nil {
		t.Fatal(err)
	}
	if debit != 1 || liability != 1 {
		t.Fatalf("unbalanced compensation posting debit=%d credit=%d", debit, liability)
	}
	changed := credit
	changed.AmountMinor = 2
	if _, _, err := CreditReviewedCustomerCompensation(s.ctx, s.db, changed); !errors.Is(err, ErrCustomerWalletCompensationConflict) {
		t.Fatalf("changed amount allowed: %v", err)
	}
	changed = credit
	changed.IdempotencyKey = "different-comp-key-" + s.suffix
	changed.ApprovedByActorID = "other-finance-operator-" + s.suffix
	reused, replayed, err := CreditReviewedCustomerCompensation(s.ctx, s.db, changed)
	if err != nil || !replayed || reused.CaseID != adjustment.ID || reused.ApprovedByActorID != credit.ApprovedByActorID {
		t.Fatalf("same approved compensation with a new retry key must replay the original credit: %+v replay=%t err=%v", reused, replayed, err)
	}
	other := caseInput
	other.AdjustmentID = "case-overcap-" + s.suffix
	other.IdempotencyKey = "create-overcap-" + s.suffix
	second, _, err := RecordOrderAdjustmentReconciliationCase(s.ctx, s.db, other)
	if err != nil {
		t.Fatal(err)
	}
	over := credit
	over.CaseID = second.ID
	over.AmountMinor = payable
	over.IdempotencyKey = "overcap-credit-" + s.suffix
	if _, _, err := CreditReviewedCustomerCompensation(s.ctx, s.db, over); !errors.Is(err, ErrCustomerWalletCompensationExceedsPayment) {
		t.Fatalf("cross-adjustment overcredit allowed: %v", err)
	}
	// An unresolved/pre-collection adjustment must never create a wallet credit.
	if _, err := s.db.ExecContext(s.ctx, `UPDATE wlt.payment_intents SET state='REQUIRES_COLLECTION',collected_amount_minor=NULL,collected_by_actor_id=NULL,
  collection_reference=NULL,collected_at=NULL WHERE id=$1`, intentID); err != nil {
		t.Fatal(err)
	}
	over.AmountMinor = 1
	if _, _, err := CreditReviewedCustomerCompensation(s.ctx, s.db, over); !errors.Is(err, ErrCustomerWalletCompensationNotCollected) {
		t.Fatalf("uncollected payment credited: %v", err)
	}
}
