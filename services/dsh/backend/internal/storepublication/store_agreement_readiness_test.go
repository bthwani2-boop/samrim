package storepublication

import (
	"testing"
	"time"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestActiveStoreAgreementMatches(t *testing.T) {
	acceptedBy := "partner-1"
	approvedBy := "finance-1"
	acceptedAt := time.Unix(1, 0).Format(time.RFC3339)
	approvedAt := time.Unix(2, 0).Format(time.RFC3339)
	effectiveAt := time.Unix(2, 0).Format(time.RFC3339)
	base := wltintegration.StoreCommercialAgreement{
		AgreementID: "agreement-1", StoreID: "store-1", PartnerActorID: "partner-1", AgreementVersion: 1, Status: "ACTIVE",
		Rates:                    []wltintegration.StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 500}},
		PartnerAcceptedByActorID: &acceptedBy, PartnerAcceptedAt: &acceptedAt,
		FinanceApprovedByActorID: &approvedBy, FinanceApprovedAt: &approvedAt, EffectiveAt: &effectiveAt,
	}
	store := postgres.StoreRecord{ID: "store-1", PartnerActorID: "partner-1", FulfillmentModes: []string{"BTHWANI_CAPTAIN"}}

	tests := []struct {
		name       string
		store      postgres.StoreRecord
		agreements []wltintegration.StoreCommercialAgreement
		want       bool
	}{
		{name: "active accepted finance approved agreement covers each store mode", store: store, agreements: []wltintegration.StoreCommercialAgreement{base}, want: true},
		{name: "missing agreement", store: store, agreements: nil},
		{name: "owner acceptance must belong to current partner", store: store, agreements: []wltintegration.StoreCommercialAgreement{{AgreementID: base.AgreementID, StoreID: base.StoreID, PartnerActorID: base.PartnerActorID, AgreementVersion: base.AgreementVersion, Status: base.Status, Rates: base.Rates, PartnerAcceptedByActorID: stringPointer("other-partner"), PartnerAcceptedAt: base.PartnerAcceptedAt, FinanceApprovedByActorID: base.FinanceApprovedByActorID, FinanceApprovedAt: base.FinanceApprovedAt, EffectiveAt: base.EffectiveAt}}},
		{name: "finance approval is required", store: store, agreements: []wltintegration.StoreCommercialAgreement{{AgreementID: base.AgreementID, StoreID: base.StoreID, PartnerActorID: base.PartnerActorID, AgreementVersion: base.AgreementVersion, Status: base.Status, Rates: base.Rates, PartnerAcceptedByActorID: base.PartnerAcceptedByActorID, PartnerAcceptedAt: base.PartnerAcceptedAt, EffectiveAt: base.EffectiveAt}}},
		{name: "all active store modes require agreed rates", store: postgres.StoreRecord{ID: store.ID, PartnerActorID: store.PartnerActorID, FulfillmentModes: []string{"BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"}}, agreements: []wltintegration.StoreCommercialAgreement{base}},
		{name: "agreement for another partner is rejected", store: postgres.StoreRecord{ID: store.ID, PartnerActorID: "partner-2", FulfillmentModes: store.FulfillmentModes}, agreements: []wltintegration.StoreCommercialAgreement{base}},
		{name: "superseded agreement is rejected", store: store, agreements: []wltintegration.StoreCommercialAgreement{{AgreementID: base.AgreementID, StoreID: base.StoreID, PartnerActorID: base.PartnerActorID, AgreementVersion: base.AgreementVersion, Status: "SUPERSEDED", Rates: base.Rates, PartnerAcceptedByActorID: base.PartnerAcceptedByActorID, PartnerAcceptedAt: base.PartnerAcceptedAt, FinanceApprovedByActorID: base.FinanceApprovedByActorID, FinanceApprovedAt: base.FinanceApprovedAt, EffectiveAt: base.EffectiveAt}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := activeStoreAgreementMatches(tt.store, tt.agreements); got != tt.want {
				t.Fatalf("activeStoreAgreementMatches() = %t, want %t", got, tt.want)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }
