package postgres

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// A cancellation may race a real collection after the same payment is reserved.
// Exactly one terminal transition must win; the losing operation must not
// create a second event or silently release a wallet reservation.
func TestConcurrentMixedPaymentCollectionAndCancellationHasSingleWinner(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, captainStore, _, pickupStore, _, _, _, _ := setupPartnerFinanceProof(t, s, true)

	cases := []struct {
		name, mode, method, store string
		cash, wallet              int64
	}{
		{"captain_cash", "BTHWANI_CAPTAIN", domain.MethodCashOnDelivery, captainStore, 1500, 0},
		{"store_cash", "CUSTOMER_PICKUP", domain.MethodCashAtStore, pickupStore, 1500, 0},
		{"store_mixed_wallet", "CUSTOMER_PICKUP", domain.MethodCashAtStore, pickupStore, 300, 1200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			orderID := fmt.Sprintf("payment-race-%s-%s", tc.name, s.suffix)
			customerID := "customer-" + orderID
			if tc.wallet > 0 {
				funding, _, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
					ActorType: "customer", ActorID: customerID, AmountMinor: tc.wallet,
					Currency: "YER", ProviderKey: DevelopmentSimulatorProvider,
					IdempotencyKey: orderID + "-funding", CorrelationID: orderID + "-funding-correlation",
				})
				if err != nil {
					t.Fatal(err)
				}
				if _, _, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
					FundingIntentID: funding.ID, Outcome: "SUCCESS",
					ProviderTransactionReference: orderID + "-provider-receipt",
					ActorID:                      "synthetic-provider", IdempotencyKey: orderID + "-credit",
					CorrelationID: orderID + "-credit-correlation",
				}); err != nil {
					t.Fatal(err)
				}
			}
			allocation := &CustomerPaymentAllocationInput{
				OrderID: orderID, StoreID: tc.store, PartnerActorID: owner,
				CommercialStoreTypeID: "finance-type", FulfillmentMode: tc.mode,
				Currency: "YER", SubtotalMinor: 1500, InternalBalanceAmountMinor: tc.wallet,
				CashAmountMinor: tc.cash, CustomerPayableMinor: 1500, PolicyVersion: "payment-race-v1",
			}
			payment, replayed, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
				ExternalReference: orderID, PayerActorID: customerID, OrderID: orderID,
				AmountMinor: tc.cash, Currency: "YER", Method: tc.method,
				CustomerPaymentAllocation: allocation,
				IdempotencyKey:            orderID + "-create", CorrelationID: orderID + "-create-correlation",
			})
			if err != nil || replayed {
				t.Fatalf("create: replay=%t err=%v", replayed, err)
			}
			before, err := ReadCustomerWalletState(s.ctx, s.db, customerID)
			if err != nil || before.LedgerBalanceMinor != tc.wallet ||
				before.AvailableMinor != 0 && tc.wallet > 0 {
				t.Fatalf("pre-race wallet=%+v err=%v", before, err)
			}
			collection := CollectPaymentIntentInput{
				IntentID: payment.ID, CollectedAmountMinor: tc.cash,
				CollectedByActorID: "collector-" + orderID, CollectionReference: orderID + "-cash-reference",
				ExpectedVersion: payment.Version, IdempotencyKey: orderID + "-collect",
				CorrelationID: orderID + "-collect-correlation",
			}
			cancellation := CancelPaymentIntentInput{
				IntentID: payment.ID, Reason: "customer cancelled before collection",
				ExpectedVersion: payment.Version, IdempotencyKey: orderID + "-cancel",
				CorrelationID: orderID + "-cancel-correlation",
			}
			type outcome struct {
				operation string
				replayed  bool
				err       error
			}
			outcomes := make(chan outcome, 2)
			start := make(chan struct{})
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				<-start
				_, replay, e := CollectPaymentIntent(s.ctx, s.db, collection)
				outcomes <- outcome{"collect", replay, e}
			}()
			go func() {
				defer wg.Done()
				<-start
				_, replay, e := CancelPaymentIntent(s.ctx, s.db, cancellation)
				outcomes <- outcome{"cancel", replay, e}
			}()
			close(start)
			wg.Wait()
			close(outcomes)
			successes, conflicts := 0, 0
			winner := ""
			for out := range outcomes {
				if out.err == nil && !out.replayed {
					successes++
					winner = out.operation
				} else if errors.Is(out.err, ErrVersionConflict) || errors.Is(out.err, ErrStateConflict) {
					conflicts++
				} else {
					t.Fatalf("unexpected %s result replay=%t err=%v", out.operation, out.replayed, out.err)
				}
			}
			if successes != 1 || conflicts != 1 {
				t.Fatalf("terminal race winners=%d conflicts=%d", successes, conflicts)
			}
			current, err := ReadPaymentIntent(s.ctx, s.db, payment.ID)
			if err != nil {
				t.Fatal(err)
			}
			expectedState := domain.StateCancelled
			if winner == "collect" {
				expectedState = domain.StateCollected
			}
			if current.State != expectedState || current.Version != payment.Version+1 {
				t.Fatalf("winner=%s current=%+v", winner, current)
			}
			var terminalEvents int
			if err := s.db.QueryRowContext(s.ctx, `SELECT count(*) FROM wlt.payment_intent_events
                WHERE intent_id=$1 AND event_type IN ('PAYMENT_INTENT_COLLECTED','PAYMENT_INTENT_CANCELLED')`,
				payment.ID).Scan(&terminalEvents); err != nil || terminalEvents != 1 {
				t.Fatalf("terminal event count=%d err=%v", terminalEvents, err)
			}
			if winner == "collect" {
				result, replay, e := CollectPaymentIntent(s.ctx, s.db, collection)
				if e != nil || !replay || result.State != domain.StateCollected {
					t.Fatalf("collect replay=%t err=%v result=%+v", replay, e, result)
				}
			} else {
				result, replay, e := CancelPaymentIntent(s.ctx, s.db, cancellation)
				if e != nil || !replay || result.State != domain.StateCancelled {
					t.Fatalf("cancel replay=%t err=%v result=%+v", replay, e, result)
				}
			}
			after, err := ReadCustomerWalletState(s.ctx, s.db, customerID)
			if err != nil || after.LedgerBalanceMinor != tc.wallet {
				t.Fatalf("ledger balance changed or failed: %+v err=%v", after, err)
			}
			available := int64(0)
			if winner == "cancel" {
				available = tc.wallet
			}
			if after.AvailableMinor != available {
				t.Fatalf("winner=%s wallet available=%d want %d", winner, after.AvailableMinor, available)
			}
		})
	}
}
