package postgres

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"testing"
)

func TestZeroCommissionStoreDeliveryMarkupBalancesLedger(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, _, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	store, city := "markup-store-"+s.suffix, "markup-city-"+s.suffix
	agreement, _, err := ProposeStoreCommercialAgreement(s.ctx, s.db, ProposeStoreCommercialAgreementInput{
		StoreID: store, PartnerActorID: owner,
		Rates:   []StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 0, DeliveryMarkupMinor: 200}},
		ActorID: "markup-operator", Reason: "zero commission offset by agreed markup",
		IdempotencyKey: store + "-propose", CorrelationID: store + "-propose-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	agreement, _, err = AcceptStoreCommercialAgreement(s.ctx, s.db, agreement.AgreementID, agreement.AgreementVersion, owner,
		"partner accepted delivery margin", store+"-accept", store+"-accept-correlation")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = DecideStoreCommercialAgreement(s.ctx, s.db, StoreCommercialAgreementDecisionInput{
		AgreementID: agreement.AgreementID, ExpectedVersion: agreement.AgreementVersion, Decision: "APPROVE",
		ActorID: "markup-finance", CurrentStorePartnerActorID: owner, CurrentFulfillmentModes: []string{"BTHWANI_CAPTAIN"},
		Reason: "approved zero commission agreement", IdempotencyKey: store + "-approve", CorrelationID: store + "-approve-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = CreateDistanceBandFeePolicy(s.ctx, s.db, CreateDistanceBandFeePolicyInput{
		ServiceCityID: city, Bands: []DeliveryDistanceBand{{RatePerKmMinor: 500}}, ExpectedVersion: 0,
		ActingActorID: "markup-finance", Reason: "isolated approved distance tariff",
		IdempotencyKey: city + "-policy", CorrelationID: city + "-policy-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	quoteInput := DeliveryFeeQuoteInput{ServiceCityID: city, OriginLatitude: 15.3694457, OriginLongitude: 44.1910064,
		DestinationLatitude: 15.3784457, DestinationLongitude: 44.1910064, OrderSizeBaseUnits: 1}
	base, err := ResolveDeliveryFeeQuote(s.ctx, s.db, quoteInput)
	if err != nil {
		t.Fatal(err)
	}
	quoteInput.StoreID = store
	quoteInput.FulfillmentMode = "BTHWANI_CAPTAIN"
	quote, err := ResolveDeliveryFeeQuote(s.ctx, s.db, quoteInput)
	if err != nil || quote.FeeMinor != base.FeeMinor+200 || quote.CaptainEarningMinor != base.FeeMinor || quote.PlatformMarginMinor != 200 {
		t.Fatalf("expected base+200 and unchanged courier pay; quote=%+v base=%+v err=%v", quote, base, err)
	}
	order, client, captain := "markup-order-"+s.suffix, "markup-client-"+s.suffix, "markup-captain-"+s.suffix
	fund, _, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
		ActorType: "captain", ActorID: captain, AmountMinor: 20000, Currency: "YER", ProviderKey: DevelopmentSimulatorProvider,
		IdempotencyKey: order + "-fund", CorrelationID: order + "-fund-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
		FundingIntentID: fund.ID, Outcome: "SUCCESS", ProviderTransactionReference: order + "-sim",
		ActorID: "markup-test-provider", IdempotencyKey: order + "-credit", CorrelationID: order + "-credit-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	total := int64(5000) + quote.FeeMinor
	p, _, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: order + "-ref", PayerActorID: client, OrderID: order, AmountMinor: total,
		Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: order, StoreID: store, PartnerActorID: owner, CommercialStoreTypeID: "finance-type",
			FulfillmentMode: "BTHWANI_CAPTAIN", Currency: "YER", SubtotalMinor: 5000,
			DeliveryFeeMinor: quote.FeeMinor, DeliveryMarginMinor: quote.PlatformMarginMinor,
			CashAmountMinor: total, CustomerPayableMinor: total, PolicyVersion: quote.PolicyVersion,
		},
		IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	cod := CaptainCODReservationInput{OrderID: order, PaymentIntentID: p.ID, CaptainActorID: captain,
		IdempotencyKey: order + "-reserve", CorrelationID: order + "-reserve-correlation"}
	if _, _, err = ReserveCaptainCOD(s.ctx, s.db, cod); err != nil {
		t.Fatal(err)
	}
	p, _, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
		IntentID: p.ID, CollectedAmountMinor: total, CollectedByActorID: captain, CollectionReference: order + "-cash",
		ExpectedVersion: p.Version, IdempotencyKey: order + "-collect", CorrelationID: order + "-collect-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	earningInput := FinalizePartnerOrderEarningInput{OrderID: order, PaymentIntentID: p.ID,
		PartnerActorID: owner, CaptainActorID: captain, IdempotencyKey: order + "-earn",
		CorrelationID: order + "-earn-correlation"}
	earning, replay, err := FinalizePartnerOrderEarning(s.ctx, s.db, earningInput)
	if err != nil || replay || earning.DeliveryFeeMinor != base.FeeMinor || earning.DeliveryMarginMinor != 200 || earning.CommissionMinor != 0 {
		t.Fatalf("earning split %+v replay=%t err=%v", earning, replay, err)
	}
	cod.IdempotencyKey = order + "-finalize"
	cod.CorrelationID = order + "-finalize-correlation"
	closed, replay, err := FinalizeCaptainCOD(s.ctx, s.db, cod)
	if err != nil || replay || closed.State != "DEBITED" {
		t.Fatalf("COD %+v replay=%t err=%v", closed, replay, err)
	}
	var debit, credit, captainCredit, margin int64
	err = s.db.QueryRowContext(s.ctx, "SELECT COALESCE(SUM(amount_minor) FILTER(WHERE direction='DEBIT'),0),COALESCE(SUM(amount_minor) FILTER(WHERE direction='CREDIT'),0),COALESCE(SUM(amount_minor) FILTER(WHERE account_code='CAPTAIN_WALLET' AND direction='CREDIT'),0),COALESCE(SUM(amount_minor) FILTER(WHERE account_code='PLATFORM_DELIVERY_MARGIN_INCOME' AND direction='CREDIT'),0) FROM wlt.ledger_entries WHERE transaction_id=$1", earning.LedgerTransactionID).
		Scan(&debit, &credit, &captainCredit, &margin)
	if err != nil || debit != credit || captainCredit != base.FeeMinor || margin != 200 {
		t.Fatalf("ledger debit=%d credit=%d captain=%d margin=%d err=%v", debit, credit, captainCredit, margin, err)
	}
	if _, replay, err = FinalizePartnerOrderEarning(s.ctx, s.db, earningInput); err != nil || !replay {
		t.Fatalf("duplicate earning replay=%t err=%v", replay, err)
	}
}
