package joiningcase

import (
	"errors"
	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"testing"
)

func TestInitialZeroCommissionRatesCoverOnlyAdmittedModes(t *testing.T) {
	modes := []string{"CUSTOMER_PICKUP", "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN"}
	rates := []wlt.StoreCommercialAgreementRate{
		{FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: 0},
		{FulfillmentMode: "CUSTOMER_PICKUP", CommissionRateBps: 0},
		{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 0},
	}
	normalized, err := normalizeStoreAgreementRates(modes, rates)
	if err != nil || len(normalized) != 3 {
		t.Fatalf("zero commission rejected: %v %v", normalized, err)
	}
	for _, rate := range normalized {
		if rate.CommissionRateBps != 0 || rate.DeliveryMarkupMinor != 0 {
			t.Fatalf("monetary value changed: %+v", rate)
		}
	}
	cases := map[string][]wlt.StoreCommercialAgreementRate{
		"missing mode":           rates[:2],
		"duplicate mode":         {rates[0], rates[0], rates[1]},
		"unknown mode":           {rates[0], rates[1], {FulfillmentMode: "UNKNOWN", CommissionRateBps: 0}},
		"negative rate":          {rates[0], rates[1], {FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: -1}},
		"markup with commission": {rates[0], rates[1], {FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 1, DeliveryMarkupMinor: 100}},
	}
	for name, candidate := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := normalizeStoreAgreementRates(modes, candidate); !errors.Is(err, ErrStoreAgreementInvalidInput) {
				t.Fatalf("invalid proposal: %v", err)
			}
		})
	}
}
