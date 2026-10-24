package postgres

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// Wallet-paid BTHWANI_CAPTAIN orders credit the delivery fee once without any
// Captain COD hold, debit, or cash remittance.
func TestCaptainWalletPaidDeliveryCreditsFeeOnce(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	order, customer, captain := "captain-wallet-order-"+s.suffix, "captain-wallet-client-"+s.suffix, "captain-wallet-actor-"+s.suffix
	funding, _, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
		ActorType: "customer", ActorID: customer, AmountMinor: 5500, Currency: "YER", ProviderKey: DevelopmentSimulatorProvider,
		IdempotencyKey: order + "-fund", CorrelationID: order + "-fund-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ProviderTransactionReference: order + "-test-credit",
		ActorID: "test-provider", IdempotencyKey: order + "-settle", CorrelationID: order + "-settle-correlation",
	}); err != nil {
		t.Fatal(err)
	}
	payment, _, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: order + "-ref", PayerActorID: customer, OrderID: order,
		AmountMinor: 0, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: order, StoreID: store, PartnerActorID: owner, CommercialStoreTypeID: "finance-type",
			FulfillmentMode: "BTHWANI_CAPTAIN", Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			InternalBalanceAmountMinor: 5500, CashAmountMinor: 0, CustomerPayableMinor: 5500,
			PolicyVersion: "wallet-delivery-proof",
		},
		IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	collected, replay, err := CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
		IntentID: payment.ID, CollectedAmountMinor: 0, ExpectedVersion: payment.Version,
		IdempotencyKey: order + "-collect", CorrelationID: order + "-collect-correlation",
	})
	if err != nil || replay || collected.State != "COLLECTED" {
		t.Fatalf("wallet collection %+v replay=%t err=%v", collected, replay, err)
	}
	earningIn := FinalizePartnerOrderEarningInput{OrderID: order, PaymentIntentID: payment.ID, PartnerActorID: owner, CaptainActorID: captain,
		IdempotencyKey: order + "-earning", CorrelationID: order + "-earning-correlation"}
	first, replay, err := FinalizePartnerOrderEarning(s.ctx, s.db, earningIn)
	if err != nil || replay || first.DeliveryFeeMinor != 500 {
		t.Fatalf("earning %+v replay=%t err=%v", first, replay, err)
	}
	_, replay, err = FinalizePartnerOrderEarning(s.ctx, s.db, earningIn)
	if err != nil || !replay {
		t.Fatalf("earning replay=%t err=%v", replay, err)
	}
	wallet, err := ReadCaptainWalletState(s.ctx, s.db, captain)
	if err != nil || wallet.LedgerBalanceMinor != 500 || wallet.HeldMinor != 0 || wallet.AvailableMinor != 500 {
		t.Fatalf("wallet paid delivery must credit exactly once: %+v err=%v", wallet, err)
	}
	var codCount int
	if err = s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE order_id=$1", order).Scan(&codCount); err != nil || codCount != 0 {
		t.Fatalf("wallet-only delivery must never reserve COD: count=%d err=%v", codCount, err)
	}
}
