package storepublication

import (
	"strings"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func activeStoreAgreementMatches(store postgres.StoreRecord, agreements []wltintegration.StoreCommercialAgreement) bool {
	return storeAgreementMatchesStatuses(store, agreements, "ACTIVE")
}

// storeAgreementModesAccepted reports whether the Partner owner has accepted
// commercial terms covering exactly the candidate modes: an ACTIVE agreement, or a
// PARTNER_ACCEPTED version still awaiting the Finance decision (which requires the
// committed modes to match before it can approve).
func storeAgreementModesAccepted(store postgres.StoreRecord, agreements []wltintegration.StoreCommercialAgreement) bool {
	return storeAgreementMatchesStatuses(store, agreements, "ACTIVE", "PARTNER_ACCEPTED")
}

func storeAgreementMatchesStatuses(store postgres.StoreRecord, agreements []wltintegration.StoreCommercialAgreement, statuses ...string) bool {
	storeID := strings.TrimSpace(store.ID)
	partnerActorID := strings.TrimSpace(store.PartnerActorID)
	if storeID == "" || partnerActorID == "" {
		return false
	}
	wantedModes, err := postgres.NormalizeStoreFulfillmentModes(store.FulfillmentModes)
	if err != nil || len(wantedModes) == 0 {
		return false
	}
	admitted := make(map[string]struct{}, len(statuses))
	for _, status := range statuses {
		admitted[status] = struct{}{}
	}
	wanted := make(map[string]struct{}, len(wantedModes))
	for _, mode := range wantedModes {
		wanted[mode] = struct{}{}
	}
	for _, agreement := range agreements {
		if _, ok := admitted[agreement.Status]; !ok {
			continue
		}
		if strings.TrimSpace(agreement.StoreID) != storeID ||
			strings.TrimSpace(agreement.PartnerActorID) != partnerActorID ||
			agreement.AgreementID == "" || agreement.AgreementVersion < 1 ||
			agreement.PartnerAcceptedByActorID == nil || strings.TrimSpace(*agreement.PartnerAcceptedByActorID) != partnerActorID ||
			agreement.PartnerAcceptedAt == nil {
			continue
		}
		if agreement.Status == "ACTIVE" && (agreement.FinanceApprovedByActorID == nil ||
			strings.TrimSpace(*agreement.FinanceApprovedByActorID) == "" || agreement.FinanceApprovedAt == nil || agreement.EffectiveAt == nil) {
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
