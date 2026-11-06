package postgres

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

func TestLegacyCODReviewRequiresIndependentFundedEvidenceAndSettlesExactlyOnce(t *testing.T) {
	s := newFieldAcquisitionScenarioWithTimeout(t, 130*time.Second)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	order := "legacy-recovery-" + s.suffix
	captain := "legacy-captain-" + s.suffix
	customer := "legacy-customer-" + s.suffix
	submitter := "finance-submitter-" + s.suffix
	approver := "finance-approver-" + s.suffix
	const cash int64 = 5500
	payment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: order + "-reference", PayerActorID: customer,
		OrderID: order, AmountMinor: cash, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: order, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			CashAmountMinor: cash, CustomerPayableMinor: cash,
			PolicyVersion: "legacy-recovery-proof",
		},
		IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
	})
	if err != nil || replay {
		t.Fatalf("create payment: replay=%v err=%v", replay, err)
	}

	// The historical record already exists in old persisted state. This
	// fixture changes only a task-owned disposable test database.
	result, err := s.db.ExecContext(s.ctx, `UPDATE wlt.payment_intents SET state='COLLECTED',
		version=version+1,collected_amount_minor=$2,collected_by_actor_id=$3,
		collection_reference=$4,collected_at=clock_timestamp(),updated_at=clock_timestamp()
		WHERE id=$1 AND state='REQUIRES_COLLECTION'`, payment.ID, cash, captain, order+"-historical-receipt")
	if err != nil {
		t.Fatalf("fixture collection: %v", err)
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		t.Fatalf("fixture rows=%d err=%v", n, err)
	}
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "CAPTAIN_COD_LEGACY_RECOVERY", Filename: "historic-collection.pdf",
		ContentType: "application/pdf", Content: []byte("%PDF-1.4\n1 0 obj\nrecovery evidence\n%%EOF"),
		ActorID: submitter, IdempotencyKey: order + "-evidence", CorrelationID: order + "-evidence-correlation",
	})
	if err != nil {
		t.Fatalf("save original evidence: %v", err)
	}
	submission := LegacyCODRecoveryInput{
		OrderID: order, PaymentIntentID: payment.ID, CaptainActorID: captain,
		EvidenceDocumentID: evidence.ID, ActorID: submitter,
		IdempotencyKey: order + "-submit", CorrelationID: order + "-submit-correlation",
	}
	wrong := submission
	wrong.CaptainActorID = captain + "-other"
	wrong.IdempotencyKey = order + "-wrong"
	if _, _, err := SubmitLegacyCODRecovery(s.ctx, s.db, wrong); !errors.Is(err, ErrLegacyCODRecoveryState) {
		t.Fatalf("wrong collector accepted: %v", err)
	}
	review, replay, err := SubmitLegacyCODRecovery(s.ctx, s.db, submission)
	if err != nil || replay || review.Status != "PENDING" || review.AmountMinor != cash {
		t.Fatalf("submit recovery: %+v replay=%v err=%v", review, replay, err)
	}
	if again, repeated, err := SubmitLegacyCODRecovery(s.ctx, s.db, submission); err != nil || !repeated || again.ID != review.ID {
		t.Fatalf("exact submit replay: %+v replay=%v err=%v", again, repeated, err)
	}
	other := submission
	other.IdempotencyKey = order + "-another-review"
	if _, _, err := SubmitLegacyCODRecovery(s.ctx, s.db, other); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("duplicate review key admitted: %v", err)
	}
	approval := LegacyCODRecoveryApprovalInput{ReviewID: review.ID, ActorID: approver, IdempotencyKey: order + "-approve", CorrelationID: order + "-approve-correlation"}
	sameActor := approval
	sameActor.ActorID = submitter
	if _, _, err := ApproveLegacyCODRecovery(s.ctx, s.db, sameActor); !errors.Is(err, ErrLegacyCODRecoverySeparation) {
		t.Fatalf("submitter approved own review: %v", err)
	}
	if _, _, err := ApproveLegacyCODRecovery(s.ctx, s.db, approval); !errors.Is(err, ErrCaptainWalletInsufficientFunds) {
		t.Fatalf("unfunded recovery created cover: %v", err)
	}
	var holds int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1", payment.ID).Scan(&holds); err != nil || holds != 0 {
		t.Fatalf("unfunded recovery had hold=%d err=%v", holds, err)
	}

	funding, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
		ActorType: "captain", ActorID: captain, AmountMinor: 20000, Currency: "YER",
		ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: order + "-funding", CorrelationID: order + "-funding-correlation",
	})
	if err != nil || replay {
		t.Fatalf("funding intent: replay=%v err=%v", replay, err)
	}
	_, replay, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ActorID: "test-payment-provider",
		ProviderTransactionReference: order + "-provider-transaction",
		IdempotencyKey:               order + "-funding-settle", CorrelationID: order + "-funding-settle-correlation",
	})
	if err != nil || replay {
		t.Fatalf("funding result: replay=%v err=%v", replay, err)
	}

	parallel := approval
	parallel.IdempotencyKey = order + "-another-approve"
	type outcome struct {
		item   LegacyCODRecoveryRecord
		replay bool
		err    error
	}
	outcomes := make(chan outcome, 2)
	var wg sync.WaitGroup
	for _, attempt := range []LegacyCODRecoveryApprovalInput{approval, parallel} {
		wg.Add(1)
		go func(input LegacyCODRecoveryApprovalInput) {
			defer wg.Done()
			item, replay, err := ApproveLegacyCODRecovery(s.ctx, s.db, input)
			outcomes <- outcome{item, replay, err}
		}(attempt)
	}
	wg.Wait()
	close(outcomes)
	success, conflict := 0, 0
	var accepted LegacyCODRecoveryRecord
	for out := range outcomes {
		switch {
		case out.err == nil && !out.replay && out.item.Status == "APPROVED":
			success++
			accepted = out.item
		case errors.Is(out.err, ErrLegacyCODRecoveryState):
			conflict++
		default:
			t.Fatalf("concurrent approve: %+v", out)
		}
	}
	if success != 1 || conflict != 1 || accepted.ReservationID == "" {
		t.Fatalf("concurrent outcomes success=%d conflict=%d record=%+v", success, conflict, accepted)
	}
	if _, replay, err := ApproveLegacyCODRecovery(s.ctx, s.db, LegacyCODRecoveryApprovalInput{
		ReviewID: review.ID, ActorID: approver,
		IdempotencyKey: order + "-another-approve", CorrelationID: order + "-replay-correlation",
	}); err != nil && !errors.Is(err, ErrLegacyCODRecoveryState) {
		t.Fatalf("terminal approval unexpected error replay=%v err=%v", replay, err)
	}
	wallet, err := ReadCaptainWalletState(s.ctx, s.db, captain)
	if err != nil || wallet.HeldMinor != cash || wallet.AvailableMinor != 20000-cash {
		t.Fatalf("reviewed cover: %+v err=%v", wallet, err)
	}
	if _, _, err := RemitCash(s.ctx, s.db, RemitCashInput{
		PaymentIntentID: payment.ID, CaptainActorID: captain, AmountMinor: cash,
		RemittanceReference: order + "-late-remit", ExpectedPaymentVersion: payment.Version + 1,
		IdempotencyKey: order + "-remit", CorrelationID: order + "-remit-correlation",
	}); !errors.Is(err, ErrRemittanceState) {
		t.Fatalf("remittance alongside approved cover was accepted: %v", err)
	}

	earning, replay, err := FinalizePartnerOrderEarning(s.ctx, s.db, FinalizePartnerOrderEarningInput{
		OrderID: order, PaymentIntentID: payment.ID, PartnerActorID: owner, CaptainActorID: captain,
		IdempotencyKey: order + "-earning", CorrelationID: order + "-earning-correlation",
	})
	if err != nil || replay || earning.DeliveryFeeMinor != 500 {
		t.Fatalf("finalize recovery earning: %+v replay=%v err=%v", earning, replay, err)
	}
	cod := CaptainCODReservationInput{
		OrderID: order, PaymentIntentID: payment.ID, CaptainActorID: captain,
		IdempotencyKey: order + "-finalize", CorrelationID: order + "-finalize-correlation",
	}
	finalized, replay, err := FinalizeCaptainCOD(s.ctx, s.db, cod)
	if err != nil || replay || finalized.State != "DEBITED" || finalized.ID != accepted.ReservationID {
		t.Fatalf("post recovery COD debit: %+v replay=%v err=%v", finalized, replay, err)
	}
	if again, replay, err := FinalizeCaptainCOD(s.ctx, s.db, cod); err != nil || !replay || again.ID != finalized.ID {
		t.Fatalf("COD debit replay: %+v replay=%v err=%v", again, replay, err)
	}
	var debitTransactions, reservationCount int
	err = s.db.QueryRowContext(s.ctx, `SELECT
		(SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1),
		(SELECT COUNT(*) FROM wlt.ledger_transactions WHERE transaction_type='CAPTAIN_COD_WALLET_DEBITED' AND source_id=$2)`,
		payment.ID, finalized.ID).Scan(&reservationCount, &debitTransactions)
	if err != nil || reservationCount != 1 || debitTransactions != 1 {
		t.Fatalf("recovery duplicate reservation/debit: reservations=%d debit=%d err=%v", reservationCount, debitTransactions, err)
	}
	wallet, err = ReadCaptainWalletState(s.ctx, s.db, captain)
	if err != nil || wallet.HeldMinor != 0 || wallet.AvailableMinor != 20000+500-cash {
		t.Fatalf("settled wallet: %+v err=%v", wallet, err)
	}

	// Two distinct Finance reviews must not share one approval idempotency key.
	// The first review has already committed its event; this second request
	// exercises the event-table UNIQUE violation, not merely a preflight check.
	secondOrder := order + "-second-review"
	secondPayment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: secondOrder + "-reference", PayerActorID: customer,
		OrderID: secondOrder, AmountMinor: cash, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: secondOrder, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			CashAmountMinor: cash, CustomerPayableMinor: cash,
			PolicyVersion: "legacy-second-review-proof",
		},
		IdempotencyKey: secondOrder + "-create", CorrelationID: secondOrder + "-create-correlation",
	})
	if err != nil || replay {
		t.Fatalf("create second isolated payment: replay=%v err=%v", replay, err)
	}
	if _, err := s.db.ExecContext(s.ctx, `UPDATE wlt.payment_intents SET state='COLLECTED',
		version=version+1,collected_amount_minor=$2,collected_by_actor_id=$3,
		collection_reference=$4,collected_at=clock_timestamp(),updated_at=clock_timestamp()
		WHERE id=$1 AND state='REQUIRES_COLLECTION'`, secondPayment.ID, cash, captain, secondOrder+"-historical-receipt"); err != nil {
		t.Fatalf("historical second collection in isolated DB: %v", err)
	}
	secondEvidence, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "CAPTAIN_COD_LEGACY_RECOVERY", Filename: "second-historical-collection.pdf",
		ContentType: "application/pdf", Content: []byte("%PDF-1.4\n1 0 obj\nsecond recovery evidence\n%%EOF"),
		ActorID: submitter, IdempotencyKey: secondOrder + "-evidence",
		CorrelationID: secondOrder + "-evidence-correlation",
	})
	if err != nil {
		t.Fatalf("save second original evidence: %v", err)
	}
	secondReview, replay, err := SubmitLegacyCODRecovery(s.ctx, s.db, LegacyCODRecoveryInput{
		PaymentIntentID: secondPayment.ID, EvidenceDocumentID: secondEvidence.ID, ActorID: submitter,
		IdempotencyKey: secondOrder + "-submit", CorrelationID: secondOrder + "-submit-correlation",
	})
	if err != nil || replay || secondReview.Status != "PENDING" {
		t.Fatalf("submit second independent review: %+v replay=%v err=%v", secondReview, replay, err)
	}
	if accepted.approvalKey == "" {
		t.Fatal("first approval lacks a persisted idempotency key")
	}
	_, _, err = ApproveLegacyCODRecovery(s.ctx, s.db, LegacyCODRecoveryApprovalInput{
		ReviewID: secondReview.ID, ActorID: approver, IdempotencyKey: accepted.approvalKey,
		CorrelationID: secondOrder + "-key-reuse-correlation",
	})
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("second review reused an approval key without a domain conflict: %v", err)
	}
	persistedSecond, err := ReadLegacyCODRecovery(s.ctx, s.db, secondReview.ID)
	if err != nil || persistedSecond.Status != "PENDING" || persistedSecond.ReservationID != "" {
		t.Fatalf("duplicate-key approval mutated second review: %+v err=%v", persistedSecond, err)
	}
	var secondHolds, firstKeyEvents int
	if err := s.db.QueryRowContext(s.ctx, `SELECT
		(SELECT count(*) FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1),
		(SELECT count(*) FROM wlt.captain_cod_reservation_events WHERE idempotency_key=$2)`,
		secondPayment.ID, accepted.approvalKey).Scan(&secondHolds, &firstKeyEvents); err != nil || secondHolds != 0 || firstKeyEvents != 1 {
		t.Fatalf("duplicate key produced a new reservation or event: holds=%d events=%d err=%v", secondHolds, firstKeyEvents, err)
	}
	walletAfterConflict, err := ReadCaptainWalletState(s.ctx, s.db, captain)
	if err != nil || walletAfterConflict.HeldMinor != wallet.HeldMinor || walletAfterConflict.AvailableMinor != wallet.AvailableMinor {
		t.Fatalf("duplicate-key approval changed wallet: before=%+v after=%+v err=%v", wallet, walletAfterConflict, err)
	}
}
