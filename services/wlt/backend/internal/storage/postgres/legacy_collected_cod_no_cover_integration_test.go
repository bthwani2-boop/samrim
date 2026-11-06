package postgres

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// A synthetic old-state UPDATE represents an already-collected payment before
// Captain COD holds became mandatory. It must only run in isolated test DBs.
func TestLegacyCollectedCaptainCODWithoutActiveCoverFailsClosed(t *testing.T) {
	s := newFieldAcquisitionScenarioWithTimeout(t, 110*time.Second)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	order := "legacy-no-cover-" + s.suffix
	captain := "legacy-captain-" + s.suffix
	customer := "legacy-customer-" + s.suffix
	const cash int64 = 5500

	payment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: order + "-ref", PayerActorID: customer,
		OrderID: order, AmountMinor: cash, Currency: "YER",
		Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: order, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			CashAmountMinor: cash, CustomerPayableMinor: cash,
			PolicyVersion: "legacy-no-cover-proof",
		},
		IdempotencyKey: order + "-create",
		CorrelationID:  order + "-create-correlation",
	})
	if err != nil || replay {
		t.Fatalf("create isolated fixture: replay=%t err=%v", replay, err)
	}

	// New collection must refuse positive cash without active full cover.
	_, _, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
		IntentID: payment.ID, CollectedAmountMinor: cash,
		CollectedByActorID: captain, CollectionReference: order + "-new",
		ExpectedVersion: payment.Version, IdempotencyKey: order + "-new-collect",
		CorrelationID: order + "-new-collect-correlation",
	})
	if !errors.Is(err, ErrStateConflict) {
		t.Fatalf("new uncovered cash collection was accepted: %v", err)
	}

	// Seed only the minimum legacy persistence state in the disposable DB.
	result, err := s.db.ExecContext(s.ctx,
		"UPDATE wlt.payment_intents SET state='COLLECTED', version=version+1, "+
			"collected_amount_minor=$2, collected_by_actor_id=$3, "+
			"collection_reference=$4, collected_at=clock_timestamp(), updated_at=clock_timestamp() "+
			"WHERE id=$1 AND state='REQUIRES_COLLECTION'",
		payment.ID, cash, captain, order+"-historical-receipt")
	if err != nil {
		t.Fatalf("seed synthetic historical state: %v", err)
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		t.Fatalf("seed exactly once: affected=%d err=%v", affected, err)
	}

	reserve := CaptainCODReservationInput{
		OrderID: order, PaymentIntentID: payment.ID, CaptainActorID: captain,
		IdempotencyKey: order + "-late-reserve",
		CorrelationID:  order + "-late-reserve-correlation",
	}
	if _, _, err := ReserveCaptainCOD(s.ctx, s.db, reserve); !errors.Is(err, ErrCaptainCODAllocationNotFound) {
		t.Fatalf("admitted a retroactive active hold: %v", err)
	}

	earning := FinalizePartnerOrderEarningInput{
		OrderID: order, PaymentIntentID: payment.ID,
		PartnerActorID: owner, CaptainActorID: captain,
		IdempotencyKey: order + "-earning",
		CorrelationID:  order + "-earning-correlation",
	}
	wrong := earning
	wrong.CaptainActorID = captain + "-other"
	wrong.IdempotencyKey = order + "-wrong-collector"
	if _, _, err := FinalizePartnerOrderEarning(s.ctx, s.db, wrong); !errors.Is(err, ErrPartnerEarningPaymentState) {
		t.Fatalf("accepted a mismatched collector: %v", err)
	}

	// Concurrent retries cannot fabricate a cover or post a new debit.
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		attempt := earning
		if i == 1 {
			attempt.IdempotencyKey = order + "-earning-retry"
			attempt.CorrelationID = order + "-earning-retry-correlation"
		}
		wg.Add(1)
		go func(input FinalizePartnerOrderEarningInput) {
			defer wg.Done()
			_, _, e := FinalizePartnerOrderEarning(s.ctx, s.db, input)
			results <- e
		}(attempt)
	}
	wg.Wait()
	close(results)
	for err := range results {
		if !errors.Is(err, ErrPartnerEarningPaymentState) {
			t.Fatalf("historical no-cover retry escaped review: %v", err)
		}
	}

	var holds, earnings, earningPostings, debits int64
	err = s.db.QueryRowContext(s.ctx,
		"SELECT "+
			"(SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1),"+
			"(SELECT COUNT(*) FROM wlt.partner_order_earnings WHERE order_id=$2),"+
			"(SELECT COUNT(*) FROM wlt.ledger_transactions WHERE source_type='ORDER_DELIVERED' AND source_id=$2),"+
			"(SELECT COUNT(*) FROM wlt.ledger_transactions WHERE source_type='CAPTAIN_COD_WALLET_DEBIT' "+
			"AND source_id IN (SELECT id FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1))",
		payment.ID, order).Scan(&holds, &earnings, &earningPostings, &debits)
	if err != nil || holds != 0 || earnings != 0 || earningPostings != 0 || debits != 0 {
		t.Fatalf("unreviewed legacy cash changed accounting: holds=%d earnings=%d postings=%d debits=%d err=%v",
			holds, earnings, earningPostings, debits, err)
	}
	// Existing Finance custody registry must retain the historical open item
	// for investigation, without exposing it as another Captain's liability.
	liability, err := ListCashLiability(s.ctx, s.db, captain, 25)
	if err != nil || liability.TotalItems != 1 || len(liability.Items) != 1 ||
		liability.Items[0].PaymentIntentID != payment.ID || liability.TotalAmountMinor != cash ||
		liability.Items[0].RemittanceState != "OPEN" {
		t.Fatalf("legacy finance exception was not visible to its Captain: %+v err=%v", liability, err)
	}
	wrongActor, err := ListCashLiability(s.ctx, s.db, captain+"-other", 25)
	if err != nil || len(wrongActor.Items) != 0 || wrongActor.TotalAmountMinor != 0 {
		t.Fatalf("historical cash liability leaked to unrelated Captain: %+v err=%v", wrongActor, err)
	}
}
