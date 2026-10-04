package storepublication

import (
	"strings"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func activeStoreAgreementMatches(store postgres.StoreRecord, agreements []wltintegration.StoreCommercialAgreement) bool {
	storeID := strings.TrimSpace(store.ID)
	partnerActorID := strings.TrimSpace(store.PartnerActorID)
	if storeID == "" || partnerActorID == "" {
		return false
	}
	wantedModes, err := postgres.NormalizeStoreFulfillmentModes(store.FulfillmentModes)
	if err != nil || len(wantedModes) == 0 {
		return false
	}
	wanted := make(map[string]struct{}, len(wantedModes))
	for _, mode := range wantedModes {
		wanted[mode] = struct{}{}
	}
	for _, agreement := range agreements {
		if strings.TrimSpace(agreement.StoreID) != storeID ||
			strings.TrimSpace(agreement.PartnerActorID) != partnerActorID ||
			agreement.AgreementID == "" || agreement.AgreementVersion < 1 || agreement.Status != "ACTIVE" ||
			agreement.PartnerAcceptedByActorID == nil || strings.TrimSpace(*agreement.PartnerAcceptedByActorID) != partnerActorID ||
			agreement.PartnerAcceptedAt == nil || agreement.FinanceApprovedByActorID == nil ||
			strings.TrimSpace(*agreement.FinanceApprovedByActorID) == "" || agreement.FinanceApprovedAt == nil || agreement.EffectiveAt == nil {
			continue
		}
		rates := make(map[string]int, len(agreement.Rates))
		valid := len(agreement.Rates) == len(wanted)
		for _, rate := range agreement.Rates {
			mode := strings.ToUpper(strings.TrimSpace(rate.FulfillmentMode))
			if _, exists := wanted[mode]; !exists || rate.CommissionRateBps < 0 || rate.CommissionRateBps > 10000 {
				valid = false
				break
			}
			if _, duplicate := rates[mode]; duplicate {
				valid = false
				break
			}
			rates[mode] = rate.CommissionRateBps
		}
		if valid && len(rates) == len(wanted) {
			return true
		}
	}
	return false
}
