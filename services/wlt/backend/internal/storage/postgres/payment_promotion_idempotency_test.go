package postgres

import "testing"

func promotionPaymentRequest() CreatePaymentIntentInput {
	allocation := validCustomerPaymentAllocation()
	allocation.OrderID = "order"
	allocation.SubtotalMinor = 4300
	allocation.DiscountMinor = 100
	share := 40
	allocation.PromotionFunding = &PromotionFundingInput{
		PromotionID: "promo-1", PromotionVersion: 2, PromotionCode: "SAVE",
		StoreID: "s", FundingSource: "SHARED", PartnerSharePercent: &share,
		DiscountMinor: 100,
	}
	return CreatePaymentIntentInput{
		ExternalReference: "ext", PayerActorID: "client", OrderID: "order",
		AmountMinor: 4200, Currency: "YER", Method: "CASH_ON_DELIVERY",
		CustomerPaymentAllocation: &allocation,
	}
}

func TestPaymentCreateHashBindsPromotionFunding(t *testing.T) {
	base := promotionPaymentRequest()
	hash := HashCreateRequest(base)
	cases := []struct {
		name   string
		change func(*CreatePaymentIntentInput)
	}{
		{"presence", func(i *CreatePaymentIntentInput) { i.CustomerPaymentAllocation.PromotionFunding = nil }},
		{"promotion-id", func(i *CreatePaymentIntentInput) {
			i.CustomerPaymentAllocation.PromotionFunding.PromotionID = "promo-2"
		}},
		{"version", func(i *CreatePaymentIntentInput) { i.CustomerPaymentAllocation.PromotionFunding.PromotionVersion++ }},
		{"code", func(i *CreatePaymentIntentInput) {
			i.CustomerPaymentAllocation.PromotionFunding.PromotionCode = "OTHER"
		}},
		{"store", func(i *CreatePaymentIntentInput) { i.CustomerPaymentAllocation.PromotionFunding.StoreID = "another" }},
		{"funding-source", func(i *CreatePaymentIntentInput) {
			i.CustomerPaymentAllocation.PromotionFunding.FundingSource = "PARTNER"
		}},
		{"share", func(i *CreatePaymentIntentInput) {
			*i.CustomerPaymentAllocation.PromotionFunding.PartnerSharePercent = 41
		}},
		{"nil-share", func(i *CreatePaymentIntentInput) {
			i.CustomerPaymentAllocation.PromotionFunding.PartnerSharePercent = nil
		}},
		{"discount", func(i *CreatePaymentIntentInput) { i.CustomerPaymentAllocation.PromotionFunding.DiscountMinor++ }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			changed := promotionPaymentRequest()
			tc.change(&changed)
			if HashCreateRequest(changed) == hash {
				t.Fatal("material promotion funding change reused the same payment intent hash")
			}
		})
	}
	equivalent := promotionPaymentRequest()
	f := equivalent.CustomerPaymentAllocation.PromotionFunding
	f.PromotionID, f.PromotionCode, f.StoreID, f.FundingSource = " promo-1 ", " SAVE ", " s ", " shared "
	if HashCreateRequest(equivalent) != hash {
		t.Fatal("equivalent canonical promotion funding facts must reuse the fingerprint")
	}
}

func TestPaymentCreateHistoricalHashCompatibility(t *testing.T) {
	base := CreatePaymentIntentInput{
		ExternalReference: "ext", PayerActorID: "client", OrderID: "order",
		AmountMinor: 4200, Currency: "YER", Method: "CASH_ON_DELIVERY",
		CustomerPaymentAllocation: ptrCustomerPaymentAllocation(validCustomerPaymentAllocation()),
	}
	// Golden hash from the pre-promotion fingerprint format; do not migrate persisted hashes.
	const oldHash = "b64b10fac7e3ffe4fd44276105385f21aa15e0df3b248dcecab7c0cddae4f51e"
	if HashCreateRequest(base) != oldHash || hashCreateRequest(base, false) != oldHash {
		t.Fatal("unfunded payment hash changed; existing intent replays would break")
	}
	withFunding := promotionPaymentRequest()
	if hashCreateRequest(withFunding, false) == HashCreateRequest(withFunding) {
		t.Fatal("funded payment still uses the unbound historical fingerprint")
	}
}

func TestPaymentHistoricalReplayComparesFrozenFunding(t *testing.T) {
	input := promotionPaymentRequest().CustomerPaymentAllocation.PromotionFunding
	share := 40
	frozen := &OrderPromotionFundingRecord{
		PromotionID: "promo-1", PromotionVersion: 2, PromotionCode: "SAVE",
		StoreID: "s", FundingSource: "SHARED", PartnerSharePct: &share,
		DiscountMinor: 100,
	}
	if !promotionFundingMatches(input, frozen) || !promotionFundingMatches(nil, nil) {
		t.Fatal("identical legacy replay facts rejected")
	}
	if promotionFundingMatches(nil, frozen) || promotionFundingMatches(input, nil) {
		t.Fatal("presence mismatch accepted on historical replay")
	}
	cases := []struct {
		name string
		edit func(*OrderPromotionFundingRecord)
	}{
		{"promotion-id", func(r *OrderPromotionFundingRecord) { r.PromotionID = "other" }},
		{"version", func(r *OrderPromotionFundingRecord) { r.PromotionVersion++ }},
		{"code", func(r *OrderPromotionFundingRecord) { r.PromotionCode = "OTHER" }},
		{"store", func(r *OrderPromotionFundingRecord) { r.StoreID = "other" }},
		{"source", func(r *OrderPromotionFundingRecord) { r.FundingSource = "BTHWANI" }},
		{"share", func(r *OrderPromotionFundingRecord) { other := 41; r.PartnerSharePct = &other }},
		{"nil-share", func(r *OrderPromotionFundingRecord) { r.PartnerSharePct = nil }},
		{"discount", func(r *OrderPromotionFundingRecord) { r.DiscountMinor++ }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			changed := *frozen
			tc.edit(&changed)
			if promotionFundingMatches(input, &changed) {
				t.Fatal("changed frozen economics passed historical idempotency check")
			}
		})
	}
}

func TestFundedPaymentRequiresMatchingAllocation(t *testing.T) {
	cases := []struct {
		name string
		edit func(*CustomerPaymentAllocationInput)
	}{
		{"zero-discount", func(a *CustomerPaymentAllocationInput) {
			a.DiscountMinor = 0
			a.SubtotalMinor = a.CustomerPayableMinor
			a.PromotionFunding.DiscountMinor = 0
		}},
		{"mismatched-discount", func(a *CustomerPaymentAllocationInput) {
			a.PromotionFunding.DiscountMinor = a.DiscountMinor + 1
		}},
		{"mismatched-store", func(a *CustomerPaymentAllocationInput) {
			a.PromotionFunding.StoreID = "another-store"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := promotionPaymentRequest()
			tc.edit(input.CustomerPaymentAllocation)
			if validateCustomerPaymentAllocation(*input.CustomerPaymentAllocation) != ErrCustomerPaymentAllocationInvalidInput {
				t.Fatal("accepted unfrozen or inconsistent promotion funding")
			}
		})
	}
	if err := validateCustomerPaymentAllocation(*promotionPaymentRequest().CustomerPaymentAllocation); err != nil {
		t.Fatalf("valid funded payment allocation rejected: %v", err)
	}
}
