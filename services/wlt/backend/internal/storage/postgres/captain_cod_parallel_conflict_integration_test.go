package postgres

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// An order can be offered to three Captains by DSH, but WLT may hold only one
// ACTIVE COD reservation. The losing reservation is a normal 409 state
// conflict, never a 502 storage failure or an additional hold.
func TestConcurrentCaptainOffersYieldOneCODHoldAndReleasableWinner(t *testing.T) {
	s := newFieldAcquisitionScenarioWithTimeout(t, 100*time.Second)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	orderID := "three-cod-order-" + s.suffix
	payment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: "three-cod-external-" + s.suffix,
		PayerActorID:      "three-cod-client-" + s.suffix,
		OrderID:           orderID, AmountMinor: 1000, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: orderID, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 1000, CashAmountMinor: 1000,
			CustomerPayableMinor: 1000, PolicyVersion: "three-cod-proof",
		},
		IdempotencyKey: "three-cod-payment-" + s.suffix, CorrelationID: "three-cod-payment-correlation-" + s.suffix,
	})
	if err != nil || replay || payment.State != "REQUIRES_COLLECTION" {
		t.Fatalf("payment setup: intent=%+v replay=%t err=%v", payment, replay, err)
	}
	captains := []string{"three-cod-a-" + s.suffix, "three-cod-b-" + s.suffix}
	for _, actor := range captains {
		funding, repeated, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
			ActorType: "captain", ActorID: actor, AmountMinor: 3000, Currency: "YER",
			ProviderKey:    DevelopmentSimulatorProvider,
			IdempotencyKey: actor + "-fund", CorrelationID: actor + "-fund-correlation",
		})
		if err != nil || repeated {
			t.Fatalf("fund %s: %v", actor, err)
		}
		settled, replayed, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
			FundingIntentID: funding.ID, Outcome: "SUCCESS",
			ProviderTransactionReference: actor + "-simulated-settlement",
			ActorID:                      "financial-proof-operator", IdempotencyKey: actor + "-settle",
			CorrelationID: actor + "-settle-correlation",
		})
		if err != nil || replayed || settled.State != "SETTLED" {
			t.Fatalf("settlement %s: %+v replay=%t err=%v", actor, settled, replayed, err)
		}
	}
	type outcome struct {
		actor       string
		reservation CaptainCODReservationRecord
		replay      bool
		err         error
	}
	results := make(chan outcome, len(captains))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, captain := range captains {
		wg.Add(1)
		go func(actor string) {
			defer wg.Done()
			<-start
			r, replayed, err := ReserveCaptainCOD(s.ctx, s.db, CaptainCODReservationInput{
				OrderID: orderID, PaymentIntentID: payment.ID,
				CaptainActorID: actor, IdempotencyKey: actor + "-reserve",
				CorrelationID: actor + "-reserve-correlation",
			})
			results <- outcome{actor, r, replayed, err}
		}(captain)
	}
	close(start)
	wg.Wait()
	close(results)
	var winning, losing string
	var winner CaptainCODReservationRecord
	for o := range results {
		switch {
		case o.err == nil && !o.replay && o.reservation.State == "ACTIVE":
			if winning != "" {
				t.Fatal("two captains simultaneously received ACTIVE reservation")
			}
			winning, winner = o.actor, o.reservation
		case errors.Is(o.err, ErrCaptainCODReservationState):
			losing = o.actor
		default:
			t.Fatalf("unexpected concurrent reserve result: %+v", o)
		}
	}
	if winning == "" || losing == "" {
		t.Fatalf("winner=%s loser=%s", winning, losing)
	}
	checkActive := func(wantActor string) {
		t.Helper()
		var active int
		var holder string
		err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*),COALESCE(MAX(captain_actor_id),'') FROM wlt.captain_cod_reservations WHERE order_id=$1 AND state='ACTIVE'", orderID).Scan(&active, &holder)
		if err != nil || active != 1 || holder != wantActor {
			t.Fatalf("ACTIVE reservations=%d holder=%s want=%s err=%v", active, holder, wantActor, err)
		}
	}
	checkActive(winning)
	beforeRelease, err := ReadCaptainWalletState(s.ctx, s.db, winning)
	if err != nil || beforeRelease.HeldMinor != 1000 || beforeRelease.AvailableMinor != 2000 {
		t.Fatalf("winner wallet before release: %+v err=%v", beforeRelease, err)
	}
	var ledgerEntriesBefore int
	var ledgerBalanceBefore int64
	if err := s.db.QueryRowContext(s.ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0)
		FROM wlt.ledger_entries WHERE account_code='CAPTAIN_WALLET' AND actor_type='captain' AND actor_id=$1 AND currency='YER'`, winning).
		Scan(&ledgerEntriesBefore, &ledgerBalanceBefore); err != nil {
		t.Fatalf("read winner ledger before release: %v", err)
	}
	released, repeated, err := ReleaseCaptainCOD(s.ctx, s.db, CaptainCODReservationInput{
		OrderID: orderID, PaymentIntentID: payment.ID, CaptainActorID: winning,
		IdempotencyKey: winning + "-release", CorrelationID: winning + "-release-correlation",
	})
	if err != nil || repeated || released.State != "RELEASED" || released.ID != winner.ID {
		t.Fatalf("release first winner: %+v repeated=%t err=%v", released, repeated, err)
	}
	replayed, repeated, err := ReleaseCaptainCOD(s.ctx, s.db, CaptainCODReservationInput{
		OrderID: orderID, PaymentIntentID: payment.ID, CaptainActorID: winning,
		IdempotencyKey: winning + "-release-retry", CorrelationID: winning + "-release-retry-correlation",
	})
	if err != nil || !repeated || replayed.ID != winner.ID || replayed.State != "RELEASED" {
		t.Fatalf("release retry after terminal state: %+v repeated=%t err=%v", replayed, repeated, err)
	}
	if _, _, err := FinalizeCaptainCOD(s.ctx, s.db, CaptainCODReservationInput{
		OrderID: orderID, PaymentIntentID: payment.ID, CaptainActorID: winning,
		IdempotencyKey: winning + "-finalize-after-release", CorrelationID: winning + "-finalize-after-release-correlation",
	}); !errors.Is(err, ErrCaptainCODReservationState) {
		t.Fatalf("released reservation must not debit Captain wallet: %v", err)
	}
	afterRelease, err := ReadCaptainWalletState(s.ctx, s.db, winning)
	if err != nil || afterRelease.LedgerBalanceMinor != beforeRelease.LedgerBalanceMinor || afterRelease.HeldMinor != 0 ||
		afterRelease.AvailableMinor != beforeRelease.AvailableMinor+beforeRelease.HeldMinor {
		t.Fatalf("winner wallet after release: before=%+v after=%+v err=%v", beforeRelease, afterRelease, err)
	}
	var ledgerEntriesAfter int
	var ledgerBalanceAfter int64
	if err := s.db.QueryRowContext(s.ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0)
		FROM wlt.ledger_entries WHERE account_code='CAPTAIN_WALLET' AND actor_type='captain' AND actor_id=$1 AND currency='YER'`, winning).
		Scan(&ledgerEntriesAfter, &ledgerBalanceAfter); err != nil {
		t.Fatalf("read winner ledger after release: %v", err)
	}
	if ledgerEntriesAfter != ledgerEntriesBefore || ledgerBalanceAfter != ledgerBalanceBefore || ledgerBalanceAfter != beforeRelease.LedgerBalanceMinor {
		t.Fatalf("COD hold release changed Captain ledger: entries %d->%d balance %d->%d wallet=%d",
			ledgerEntriesBefore, ledgerEntriesAfter, ledgerBalanceBefore, ledgerBalanceAfter, beforeRelease.LedgerBalanceMinor)
	}
	second, repeated, err := ReserveCaptainCOD(s.ctx, s.db, CaptainCODReservationInput{
		OrderID: orderID, PaymentIntentID: payment.ID, CaptainActorID: losing,
		IdempotencyKey: losing + "-reserve-after-release", CorrelationID: losing + "-reserve-after-release-correlation",
	})
	if err != nil || repeated || second.State != "ACTIVE" {
		t.Fatalf("loser cannot reserve after prior release: %+v repeated=%t err=%v", second, repeated, err)
	}
	checkActive(losing)
	var reserveEvents, activeHolds int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FILTER (WHERE state='ACTIVE'),COUNT(*) FROM wlt.captain_cod_reservations WHERE order_id=$1", orderID).Scan(&activeHolds, &reserveEvents); err != nil {
		t.Fatal(err)
	}
	if activeHolds != 1 || reserveEvents != 2 {
		t.Fatalf("expected one ACTIVE and one RELEASED reservation, got active=%d total=%d", activeHolds, reserveEvents)
	}
}
