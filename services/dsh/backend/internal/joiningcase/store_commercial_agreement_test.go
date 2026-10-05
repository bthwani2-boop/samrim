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

func TestFieldAgreementProposalCanAdvancePublishedStoreTerms(t *testing.T) {
	if !fieldMayProposeStoreAgreement("unpublished") {
		t.Fatal("initial proposal for an unpublished store was rejected")
	}
	if !fieldMayProposeStoreAgreement("published") {
		t.Fatal("published Store could not start a WLT-versioned agreement proposal")
	}
	// The durable mode path (unpublish, commit modes, fresh agreement version,
	// republish) requires Field to propose while the Store is temporarily hidden.
	if !fieldMayProposeStoreAgreement("hidden") {
		t.Fatal("hidden Store lost Field proposal authority for the governed mode-change window")
	}
}

func TestPartnerAgreementAcceptanceReadbackAllowsOnlyConfirmedLaterStatesOnReplay(t *testing.T) {
	tests := []struct {
		status   string
		replayed bool
		want     bool
	}{
		{status: "PARTNER_ACCEPTED", want: true},
		{status: "PARTNER_ACCEPTED", replayed: true, want: true},
		{status: "ACTIVE", replayed: true, want: true},
		{status: "FINANCE_REJECTED", replayed: true, want: true},
		{status: "SUPERSEDED", replayed: true, want: true},
		{status: "ACTIVE"},
		{status: "PROPOSED", replayed: true},
	}
	for _, tt := range tests {
		t.Run(tt.status+"/replayed="+map[bool]string{true: "true", false: "false"}[tt.replayed], func(t *testing.T) {
			if got := partnerAgreementAcceptanceStatusConfirmed(tt.status, tt.replayed); got != tt.want {
				t.Fatalf("partnerAgreementAcceptanceStatusConfirmed(%q, %t) = %t, want %t", tt.status, tt.replayed, got, tt.want)
			}
		})
	}
}
