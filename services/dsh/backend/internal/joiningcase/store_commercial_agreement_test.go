package joiningcase

import (
	"testing"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func TestNormalizeStoreAgreementRatesRequiresExactEnabledModeSet(t *testing.T) {
	tests := []struct {
		name  string
		modes []string
		rates []wltintegration.StoreCommercialAgreementRate
		want  []wltintegration.StoreCommercialAgreementRate
	}{
		{
			name:  "canonicalizes and orders all enabled modes",
			modes: []string{"CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"},
			rates: []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "customer_pickup", CommissionRateBps: 0}, {FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 10000}},
			want:  []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 10000}, {FulfillmentMode: "CUSTOMER_PICKUP", CommissionRateBps: 0}},
		},
		{
			name:  "missing enabled mode rate is rejected",
			modes: []string{"BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"},
			rates: []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 100}},
		},
		{
			name:  "duplicate rate is rejected",
			modes: []string{"BTHWANI_CAPTAIN"},
			rates: []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 100}, {FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 200}},
		},
		{
			name:  "out of range rate is rejected",
			modes: []string{"BTHWANI_CAPTAIN"},
			rates: []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 10001}},
		},
		{
			name:  "unknown mode is rejected",
			modes: []string{"BTHWANI_CAPTAIN"},
			rates: []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: 100}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeStoreAgreementRates(tt.modes, tt.rates)
			if len(tt.want) == 0 {
				if err == nil {
					t.Fatalf("normalizeStoreAgreementRates() accepted invalid rates: %#v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeStoreAgreementRates() error = %v", err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("normalized rates length = %d, want %d", len(got), len(tt.want))
			}
			for index := range got {
				if got[index] != tt.want[index] {
					t.Fatalf("normalized rate[%d] = %+v, want %+v", index, got[index], tt.want[index])
				}
			}
		})
	}
}

func TestFieldAgreementProposalCanRecoverPublishedStoreOnlyWithoutAgreementHistory(t *testing.T) {
	if !fieldMayProposeStoreAgreement("unpublished", []wltintegration.StoreCommercialAgreement{{AgreementID: "existing"}}) {
		t.Fatal("initial proposal for an unpublished store was rejected")
	}
	if !fieldMayProposeStoreAgreement("published", nil) {
		t.Fatal("published legacy store with no WLT agreement history has no safe re-contract path")
	}
	for _, status := range []string{"PROPOSED", "PARTNER_ACCEPTED", "ACTIVE", "FINANCE_REJECTED", "SUPERSEDED"} {
		t.Run(status, func(t *testing.T) {
			history := []wltintegration.StoreCommercialAgreement{{AgreementID: "history", Status: status}}
			if fieldMayProposeStoreAgreement("published", history) {
				t.Fatalf("published store with agreement history %s may not start a cutover proposal", status)
			}
		})
	}
	if fieldMayProposeStoreAgreement("hidden", nil) {
		t.Fatal("hidden store unexpectedly retained Field proposal authority")
	}
}
