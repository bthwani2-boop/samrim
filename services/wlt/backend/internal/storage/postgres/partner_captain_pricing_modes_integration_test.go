package postgres

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"testing"
)

// Partner Captains are employed by their Stores. Their customer's delivery
// charge may be free, fixed or city-distance-priced; BThwani never records
// this fee as a BThwani Captain earning or platform delivery margin.
func TestPartnerCaptainApprovedFreeFixedAndDistanceDelivery(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, _, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	city := "partner-fee-city-" + s.suffix
	_, _, err := CreateDistanceBandFeePolicy(s.ctx, s.db, CreateDistanceBandFeePolicyInput{
		ServiceCityID: city, Bands: []DeliveryDistanceBand{{RatePerKmMinor: 500}},
		ExpectedVersion: 0, ActingActorID: "test-finance", Reason: "approved distance tariff for partner captain",
		IdempotencyKey: city + "-policy", CorrelationID: city + "-policy-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	input := DeliveryFeeQuoteInput{ServiceCityID: city, OriginLatitude: 15.3694457,
		OriginLongitude: 44.1910064, DestinationLatitude: 15.3784457, DestinationLongitude: 44.1910064,
		OrderSizeBaseUnits: 1}
	base, err := ResolveDeliveryFeeQuote(s.ctx, s.db, input)
	if err != nil || base.FeeMinor <= 0 {
		t.Fatalf("base fee %+v err=%v", base, err)
	}
	cases := []struct {
		mode            string
		fixed, expected int64
	}{
		{"FREE", 0, 0}, {"FIXED", 380, 380}, {"DISTANCE", 0, base.FeeMinor},
	}
	for _, tc := range cases {
		t.Run(tc.mode, func(t *testing.T) {
			store := "partner-" + tc.mode + "-" + s.suffix
			agreement, _, err := ProposeStoreCommercialAgreement(s.ctx, s.db, ProposeStoreCommercialAgreementInput{
				StoreID: store, PartnerActorID: owner,
				Rates: []StoreCommercialAgreementRate{{FulfillmentMode: "PARTNER_CAPTAIN",
					CommissionRateBps: 500, DeliveryPricingMode: tc.mode, DeliveryFixedFeeMinor: tc.fixed}},
				ActorID: "field-finance", Reason: "Store and partner jointly approved delivery fee mode",
				IdempotencyKey: store + "-propose", CorrelationID: store + "-propose-correlation",
			})
			if err != nil {
				t.Fatal(err)
			}
			agreement, _, err = AcceptStoreCommercialAgreement(s.ctx, s.db, agreement.AgreementID,
				agreement.AgreementVersion, owner, "reviewed customer delivery charge", store+"-accept", store+"-accept-correlation")
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = DecideStoreCommercialAgreement(s.ctx, s.db, StoreCommercialAgreementDecisionInput{
				AgreementID: agreement.AgreementID, ExpectedVersion: agreement.AgreementVersion,
				Decision: "APPROVE", ActorID: "finance-approver", CurrentStorePartnerActorID: owner,
				CurrentFulfillmentModes: []string{"PARTNER_CAPTAIN"}, Reason: "delivery fee was reviewed and accepted",
				IdempotencyKey: store + "-approve", CorrelationID: store + "-approve-correlation",
			})
			if err != nil {
				t.Fatal(err)
			}
			input.StoreID = store
			input.FulfillmentMode = "PARTNER_CAPTAIN"
			quote, err := ResolveDeliveryFeeQuote(s.ctx, s.db, input)
			if err != nil || quote.FeeMinor != tc.expected || quote.CaptainEarningMinor != 0 || quote.PlatformMarginMinor != 0 {
				t.Fatalf("unexpected Partner Captain fee %+v expected=%d err=%v", quote, tc.expected, err)
			}
			history, err := ReadStoreCommercialAgreements(s.ctx, s.db, store)
			if err != nil || len(history) != 1 || len(history[0].Rates) != 1 || history[0].Rates[0].DeliveryPricingMode != tc.mode ||
				history[0].Rates[0].DeliveryFixedFeeMinor != tc.fixed {
				t.Fatalf("frozen mode readback %+v err=%v", history, err)
			}
			// The Store collects its own COD sale and delivery fee; WLT records
			// product commission only, never BThwani Captain COD exposure.
			order := store + "-order"
			customer := store + "-customer"
			total := int64(5000) + quote.FeeMinor
			payment, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
				ExternalReference: order + "-ref", PayerActorID: customer, OrderID: order,
				AmountMinor: total, Currency: "YER", Method: domain.MethodCashAtStore,
				CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
					OrderID: order, StoreID: store, PartnerActorID: owner,
					CommercialStoreTypeID: "finance-type", FulfillmentMode: "PARTNER_CAPTAIN", Currency: "YER",
					SubtotalMinor: 5000, DeliveryFeeMinor: quote.FeeMinor, CashAmountMinor: total,
					CustomerPayableMinor: total, PolicyVersion: quote.PolicyVersion,
				},
				IdempotencyKey: order + "-create", CorrelationID: order + "-create-correlation",
			})
			if err != nil || replay {
				t.Fatalf("payment %+v replay=%t err=%v", payment, replay, err)
			}
			payment, replay, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
				IntentID: payment.ID, CollectedAmountMinor: total, CollectedByActorID: owner,
				CollectionReference: order + "-cash", ExpectedVersion: payment.Version,
				IdempotencyKey: order + "-collect", CorrelationID: order + "-collect-correlation",
			})
			if err != nil || replay || payment.State != "COLLECTED" {
				t.Fatalf("cash collected by Store %+v replay=%t err=%v", payment, replay, err)
			}
			commissionInput := PartnerStoreCashCommissionInput{OrderID: order,
				PaymentIntentID: payment.ID, PartnerActorID: owner, FulfillmentMode: "PARTNER_CAPTAIN",
				IdempotencyKey: order + "-commission", CorrelationID: order + "-commission-correlation"}
			commission, replay, err := RecordPartnerStoreCashCommission(s.ctx, s.db, commissionInput)
			if err != nil || replay || commission.CommissionMinor != 250 {
				t.Fatalf("commission must charge products only: %+v replay=%t err=%v", commission, replay, err)
			}
			if _, replay, err = RecordPartnerStoreCashCommission(s.ctx, s.db, commissionInput); err != nil || !replay {
				t.Fatalf("commission replay=%t err=%v", replay, err)
			}
			var captainHolds, captainEarnings int
			if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE order_id=$1", order).Scan(&captainHolds); err != nil {
				t.Fatal(err)
			}
			if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.partner_order_earnings WHERE order_id=$1", order).Scan(&captainEarnings); err != nil {
				t.Fatal(err)
			}
			if captainHolds != 0 || captainEarnings != 0 {
				t.Fatalf("Store courier must have no BThwani Captain custody or earning: holds=%d earnings=%d", captainHolds, captainEarnings)
			}

		})
	}
}
