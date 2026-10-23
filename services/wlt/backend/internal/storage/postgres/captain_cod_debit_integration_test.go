package postgres

import (
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// Real Postgres proof: WLT posts the receivable once, then settles it by
// debiting Captain Wallet. A collected COD order never requires remittance.
func TestCaptainCODCashDebitIsExactlyOnce(t *testing.T) {
	for _, tc := range []struct {
		name            string
		cash            int64
		customerBalance int64
		captainFund     int64
		eligible        int64
	}{
		{"cash", 5500, 0, 20000, 500},
		{"mixed", 2500, 3000, 20000, 500},
		{"below-initial-activation-threshold", 5500, 0, 10000, 500},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newFieldAcquisitionScenario(t)
			owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
			order := "captain-debit-" + tc.name + "-" + s.suffix
			captain := "captain-debit-actor-" + tc.name + "-" + s.suffix
			customer := "captain-debit-customer-" + tc.name + "-" + s.suffix

			credit := func(actorType, actorID string, amount int64) {
				t.Helper()
				funding, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
					ActorType: actorType, ActorID: actorID, AmountMinor: amount, Currency: "YER",
					ProviderKey:    DevelopmentSimulatorProvider,
					IdempotencyKey: order + "-fund-" + actorType,
					CorrelationID:  order + "-fund-" + actorType + "-correlation",
				})
				if err != nil || replay {
					t.Fatalf("fund %s: replay=%t err=%v", actorType, replay, err)
				}
				result, replay, err := ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
					FundingIntentID: funding.ID, Outcome: "SUCCESS",
					ProviderTransactionReference: order + "-sim-" + actorType,
					ActorID:                      "test-payment-provider",
					IdempotencyKey:               order + "-credit-" + actorType,
					CorrelationID:                order + "-credit-" + actorType + "-correlation",
				})
				if err != nil || replay || result.State != "SETTLED" {
					t.Fatalf("credit %s: result=%+v replay=%t err=%v", actorType, result, replay, err)
				}
			}
			credit("captain", captain, tc.captainFund)
			if tc.customerBalance > 0 {
				credit("customer", customer, tc.customerBalance)
			}

			payment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
				ExternalReference: order + "-ref", PayerActorID: customer,
				OrderID: order, AmountMinor: tc.cash, Currency: "YER", Method: domain.MethodCashOnDelivery,
				CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
					OrderID: order, StoreID: store, PartnerActorID: owner,
					CommercialStoreTypeID: "finance-type",
					FulfillmentMode:       "BTHWANI_CAPTAIN", Currency: "YER",
					SubtotalMinor: 5000, DeliveryFeeMinor: 500,
					CashAmountMinor: tc.cash, InternalBalanceAmountMinor: tc.customerBalance,
					CustomerPayableMinor: 5500, PolicyVersion: "captain-cod-test",
				},
				IdempotencyKey: order + "-create",
				CorrelationID:  order + "-create-correlation",
			})
			if err != nil || replay {
				t.Fatalf("create payment: replay=%t err=%v", replay, err)
			}
			reservationInput := CaptainCODReservationInput{
				OrderID: order, PaymentIntentID: payment.ID, CaptainActorID: captain,
				IdempotencyKey: order + "-reserve", CorrelationID: order + "-reserve-correlation",
			}
			hold, replay, err := ReserveCaptainCOD(s.ctx, s.db, reservationInput)
			if err != nil || replay || hold.State != "ACTIVE" || hold.AmountMinor != tc.cash {
				t.Fatalf("reserve: %+v replay=%t err=%v", hold, replay, err)
			}
			before, err := ReadCaptainWalletState(s.ctx, s.db, captain)
			if err != nil || before.HeldMinor != tc.cash || before.AvailableMinor != tc.captainFund-tc.cash {
				t.Fatalf("before delivery: %+v err=%v", before, err)
			}
			final := reservationInput
			final.IdempotencyKey = order + "-finalize"
			final.CorrelationID = order + "-finalize-correlation"
			if _, _, err = FinalizeCaptainCOD(s.ctx, s.db, final); !errors.Is(err, ErrCaptainCODReservationState) {
				t.Fatalf("debit before collected earning must fail, got %v", err)
			}
			_, replay, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
				IntentID: payment.ID, CollectedAmountMinor: tc.cash,
				CollectedByActorID: captain, CollectionReference: order + "-collected",
				ExpectedVersion: payment.Version, IdempotencyKey: order + "-collect",
				CorrelationID: order + "-collect-correlation",
			})
			if err != nil || replay {
				t.Fatalf("collect: replay=%t err=%v", replay, err)
			}
			earningInput := FinalizePartnerOrderEarningInput{
				OrderID: order, PaymentIntentID: payment.ID, PartnerActorID: owner,
				CaptainActorID: captain, IdempotencyKey: order + "-earning",
				CorrelationID: order + "-earning-correlation",
			}
			earning, replay, err := FinalizePartnerOrderEarning(s.ctx, s.db, earningInput)
			if err != nil || replay || earning.DeliveryFeeMinor != 500 {
				t.Fatalf("earning: %+v replay=%t err=%v", earning, replay, err)
			}
			settled, replay, err := FinalizeCaptainCOD(s.ctx, s.db, final)
			if err != nil || replay || settled.State != "DEBITED" {
				t.Fatalf("finalize: %+v replay=%t err=%v", settled, replay, err)
			}
			again, replay, err := FinalizeCaptainCOD(s.ctx, s.db, final)
			if err != nil || !replay || again.ID != settled.ID {
				t.Fatalf("replayed debit: %+v replay=%t err=%v", again, replay, err)
			}
			wallet, err := ReadCaptainWalletState(s.ctx, s.db, captain)
			if err != nil || wallet.HeldMinor != 0 || wallet.AvailableMinor != tc.captainFund+500-tc.cash {
				t.Fatalf("post delivery wallet: %+v err=%v", wallet, err)
			}
			var debitCount int
			var debitTotal, creditTotal int64
			err = s.db.QueryRowContext(s.ctx, `SELECT COUNT(*), COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='DEBIT'),0),
                COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='CREDIT'),0)
                FROM wlt.ledger_transactions t JOIN wlt.ledger_entries e ON e.transaction_id=t.id
                WHERE t.source_type='CAPTAIN_COD_WALLET_DEBIT' AND t.source_id=$1`, settled.ID).
				Scan(&debitCount, &debitTotal, &creditTotal)
			if err != nil || debitCount != 2 || debitTotal != tc.cash || creditTotal != tc.cash {
				t.Fatalf("unbalanced or duplicated wallet debit: lines=%d debits=%d credits=%d err=%v",
					debitCount, debitTotal, creditTotal, err)
			}
			// A large Captain top-up is not automatically earned delivery income.
			// Only actual delivery earnings are withdrawable; the initial activation
			// threshold is not an ongoing payout floor.
			if _, err := ReadCaptainMinimumBalancePolicy(s.ctx, s.db); errors.Is(err, ErrCaptainMinimumBalancePolicyNotFound) {
				_, _, err = CreateCaptainMinimumBalancePolicy(s.ctx, s.db, CreateCaptainMinimumBalancePolicyInput{
					MinimumAvailableMinor: 10000, ExpectedVersion: 0,
					Reason: "isolated captain payout guard proof", ActingActorID: "test-finance-operator",
					IdempotencyKey: order + "-minimum", CorrelationID: order + "-minimum-correlation",
				})
				if err != nil {
					t.Fatalf("configure minimum: %v", err)
				}
			} else if err != nil {
				t.Fatalf("read minimum: %v", err)
			}
			payout, err := ReadPayoutState(s.ctx, s.db, "captain", captain)
			if err != nil || payout.EligibleAvailableMinor != tc.eligible {
				t.Fatalf("only delivery earnings can be paid out: %+v err=%v", payout, err)
			}
			requested := tc.eligible + 1
			_, _, err = CreateSettlementIntake(s.ctx, s.db, SettlementIntakeInput{
				ActorType: "captain", ActorID: captain, RequestedBy: captain, AmountMode: "SPECIFIED",
				AmountMinor: &requested, IdempotencyKey: order + "-excess-intake",
				CorrelationID: order + "-excess-intake-correlation",
			})
			if !errors.Is(err, ErrPayoutAmountExceeded) {
				t.Fatalf("excess settlement intake must be rejected, got %v", err)
			}
			if tc.eligible > 0 {
				intake, replay, err := CreateSettlementIntake(s.ctx, s.db, SettlementIntakeInput{
					ActorType: "captain", ActorID: captain, RequestedBy: captain,
					AmountMode: "FULL_AVAILABLE", IdempotencyKey: order + "-intake",
					CorrelationID: order + "-intake-correlation",
				})
				if err != nil || replay || intake.ResolvedAmountMinor != tc.eligible {
					t.Fatalf("eligible earnings intake only: %+v replay=%t err=%v", intake, replay, err)
				}
			}
			custody, err := ListCashLiability(s.ctx, s.db, captain, 25)
			if err != nil || len(custody.Items) != 0 || custody.TotalAmountMinor != 0 {
				t.Fatalf("already debited COD must never request remittance: %+v err=%v", custody, err)
			}
		})
	}
}
