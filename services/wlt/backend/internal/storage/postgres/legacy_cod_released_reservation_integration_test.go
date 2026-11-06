package postgres

import (
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// Pre-061 records can retain a RELEASED reservation even though collection
// happened under the old policy. That release is not settled cash, and Finance
// must still be able to submit a reviewed recovery for the original collector.
func TestLegacyCODReleasedOnlyReservationAllowsEvidenceBoundSubmission(t *testing.T) {
	s := newFieldAcquisitionScenarioWithTimeout(t, 100*time.Second)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	order := "legacy-released-" + s.suffix
	captain := "legacy-captain-" + s.suffix
	finance := "legacy-finance-" + s.suffix
	const cash int64 = 5500

	payment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: order + "-ref", PayerActorID: "client-" + s.suffix,
		OrderID: order, AmountMinor: cash, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: order, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			CashAmountMinor: cash, CustomerPayableMinor: cash, PolicyVersion: "legacy-released-proof",
		},
		IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
	})
	if err != nil || replay {
		t.Fatalf("create isolated historical payment: replay=%v err=%v", replay, err)
	}
	if _, err := s.db.ExecContext(s.ctx, `UPDATE wlt.payment_intents SET state='COLLECTED',
		version=version+1,collected_amount_minor=$2,collected_by_actor_id=$3,
		collection_reference=$4,collected_at=clock_timestamp(),updated_at=clock_timestamp()
		WHERE id=$1 AND state='REQUIRES_COLLECTION'`, payment.ID, cash, captain, order+"-old-receipt"); err != nil {
		t.Fatalf("set historical COLLECTED state in disposable database: %v", err)
	}
	releasedID := order + "-released-hold"
	if _, err := s.db.ExecContext(s.ctx, `INSERT INTO wlt.captain_cod_reservations
		(id,order_id,payment_intent_id,captain_actor_id,amount_minor,currency,state,reserve_idempotency_key,request_hash,correlation_id,released_at)
		VALUES($1,$2,$3,$4,$5,'YER','RELEASED',$6,$7,$8,clock_timestamp())`,
		releasedID, order, payment.ID, captain, cash, order+"-old-hold", order+"-old-hash", order+"-old-correlation"); err != nil {
		t.Fatalf("preserve released historical hold: %v", err)
	}

	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "CAPTAIN_COD_LEGACY_RECOVERY", Filename: "released-history.pdf",
		ContentType: "application/pdf", Content: []byte("%PDF-1.4\n1 0 obj\nreleased evidence\n%%EOF"),
		ActorID: finance, IdempotencyKey: order + "-evidence", CorrelationID: order + "-evidence-correlation",
	})
	if err != nil {
		t.Fatalf("save evidence: %v", err)
	}
	review, replay, err := SubmitLegacyCODRecovery(s.ctx, s.db, LegacyCODRecoveryInput{
		PaymentIntentID: payment.ID, EvidenceDocumentID: evidence.ID, ActorID: finance,
		IdempotencyKey: order + "-submit", CorrelationID: order + "-submit-correlation",
	})
	if err != nil || replay || review.Status != "PENDING" || review.AmountMinor != cash || review.CaptainActorID != captain {
		t.Fatalf("released-only recovery review: %+v replay=%v err=%v", review, replay, err)
	}
	// Funding and approval must create exactly one new ACTIVE hold while the
	// RELEASED historical row stays untouched. Finalization must select ACTIVE.
	funding, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
		ActorType: "captain", ActorID: captain, AmountMinor: 20000, Currency: "YER",
		ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: order + "-funding",
		CorrelationID: order + "-funding-correlation",
	})
	if err != nil || replay {
		t.Fatalf("create isolated funding intent: replay=%v err=%v", replay, err)
	}
	_, replay, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ActorID: "test-payment-provider",
		ProviderTransactionReference: order + "-provider-transaction",
		IdempotencyKey:               order + "-funding-settle", CorrelationID: order + "-funding-settle-correlation",
	})
	if err != nil || replay {
		t.Fatalf("fund Captain test wallet: replay=%v err=%v", replay, err)
	}
	approved, replay, err := ApproveLegacyCODRecovery(s.ctx, s.db, LegacyCODRecoveryApprovalInput{
		ReviewID: review.ID, ActorID: "finance-reviewer-" + s.suffix,
		IdempotencyKey: order + "-approve", CorrelationID: order + "-approve-correlation",
	})
	if err != nil || replay || approved.Status != "APPROVED" || approved.ReservationID == "" || approved.ReservationID == releasedID {
		t.Fatalf("approved funded historical hold: %+v replay=%v err=%v", approved, replay, err)
	}
	earning, replay, err := FinalizePartnerOrderEarning(s.ctx, s.db, FinalizePartnerOrderEarningInput{
		OrderID: order, PaymentIntentID: payment.ID, PartnerActorID: owner, CaptainActorID: captain,
		IdempotencyKey: order + "-earning", CorrelationID: order + "-earning-correlation",
	})
	if err != nil || replay || earning.DeliveryFeeMinor != 500 {
		t.Fatalf("finalize reviewed historical earning: %+v replay=%v err=%v", earning, replay, err)
	}
	codInput := CaptainCODReservationInput{
		OrderID: order, PaymentIntentID: payment.ID, CaptainActorID: captain,
		IdempotencyKey: order + "-finalize", CorrelationID: order + "-finalize-correlation",
	}
	finalized, replay, err := FinalizeCaptainCOD(s.ctx, s.db, codInput)
	if err != nil || replay || finalized.State != "DEBITED" || finalized.ID != approved.ReservationID {
		t.Fatalf("finalize correct ACTIVE hold among RELEASED history: %+v replay=%v err=%v", finalized, replay, err)
	}
	if again, repeated, err := FinalizeCaptainCOD(s.ctx, s.db, codInput); err != nil || !repeated || again.ID != finalized.ID {
		t.Fatalf("replay settled hold: %+v replay=%v err=%v", again, repeated, err)
	}
	var heldState string
	if err := s.db.QueryRowContext(s.ctx, "SELECT state FROM wlt.captain_cod_reservations WHERE id=$1", releasedID).Scan(&heldState); err != nil || heldState != "RELEASED" {
		t.Fatalf("historical released hold mutated: state=%s err=%v", heldState, err)
	}
	var reservations, debits int
	if err := s.db.QueryRowContext(s.ctx, `SELECT
		(SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1),
		(SELECT COUNT(*) FROM wlt.ledger_transactions WHERE transaction_type='CAPTAIN_COD_WALLET_DEBITED' AND source_id=$2)`,
		payment.ID, finalized.ID).Scan(&reservations, &debits); err != nil || reservations != 2 || debits != 1 {
		t.Fatalf("historical RELEASED + funded DEBITED exactly once: reservations=%d debits=%d err=%v", reservations, debits, err)
	}
}
