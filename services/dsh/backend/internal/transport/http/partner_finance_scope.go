package transporthttp

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type partnerScopedFinanceStore struct {
	wlt.PartnerStoreFinance
	StoreName        string `json:"storeName"`
	SettlementPeriod string `json:"settlementPeriod"`
}

type partnerScopedFinanceSummary struct {
	OwnerCommissionReceivableMinor *int64                      `json:"ownerCommissionReceivableMinor,omitempty"`
	AttributionComplete            bool                        `json:"attributionComplete"`
	Currency                       string                      `json:"currency"`
	EarnedMinor                    int64                       `json:"earnedMinor"`
	CommissionMinor                int64                       `json:"commissionMinor"`
	OrderCount                     int64                       `json:"orderCount"`
	EligibleAvailableMinor         int64                       `json:"eligibleAvailableMinor"`
	HeldMinor                      int64                       `json:"heldMinor"`
	SettledMinor                   int64                       `json:"settledMinor"`
	Stores                         []partnerScopedFinanceStore `json:"stores"`
}

func selectPartnerFinanceScope(stores []postgres.PartnerFinanceStore, requested []string) ([]postgres.PartnerFinanceStore, error) {
	if len(stores) == 0 {
		return nil, postgres.ErrStoreAccessForbidden
	}
	if len(requested) == 0 {
		return stores, nil
	}
	allowed := make(map[string]postgres.PartnerFinanceStore, len(stores))
	for _, store := range stores {
		allowed[store.ID] = store
	}
	selected := make([]postgres.PartnerFinanceStore, 0, len(requested))
	seen := map[string]bool{}
	for _, id := range requested {
		id = strings.TrimSpace(id)
		store, ok := allowed[id]
		if !ok {
			return nil, postgres.ErrStoreAccessForbidden
		}
		if !seen[id] {
			selected = append(selected, store)
			seen[id] = true
		}
	}
	return selected, nil
}

func readPartnerScopedFinance(ctx context.Context, payment *wlt.Client, stores []postgres.PartnerFinanceStore, fullOwner string) (partnerScopedFinanceSummary, error) {
	result := partnerScopedFinanceSummary{AttributionComplete: true, Currency: "YER", Stores: make([]partnerScopedFinanceStore, 0, len(stores))}
	owners := map[string][]string{}
	names := map[string]string{}
	for _, store := range stores {
		owners[store.PartnerActorID] = append(owners[store.PartnerActorID], store.ID)
		names[store.ID] = store.Name
	}
	ownerIDs := make([]string, 0, len(owners))
	for owner := range owners {
		ownerIDs = append(ownerIDs, owner)
	}
	sort.Strings(ownerIDs)
	for _, owner := range ownerIDs {
		readback, err := payment.ReadPartnerFinancialSummaryForStores(ctx, owner, owners[owner])
		if err != nil {
			return result, err
		}
		availableBefore, heldBefore, settledBefore, earnedBefore := result.EligibleAvailableMinor, result.HeldMinor, result.SettledMinor, result.EarnedMinor
		// Fail closed if the service readback omits, duplicates or widens scope.
		remaining := map[string]bool{}
		for _, id := range owners[owner] {
			remaining[id] = true
		}
		for _, store := range readback.Stores {
			if !remaining[store.StoreID] || store.PartnerActorID != owner || store.Currency != result.Currency {
				return result, &wlt.Error{Status: 502, Code: "INVALID_FINANCE_READBACK", Message: "WLT Store finance scope does not match the authorized scope"}
			}
			delete(remaining, store.StoreID)
			result.Stores = append(result.Stores, partnerScopedFinanceStore{PartnerStoreFinance: store, StoreName: names[store.StoreID], SettlementPeriod: readback.SettlementPeriod})
			result.AttributionComplete = result.AttributionComplete && store.AttributionComplete
			result.EarnedMinor += store.EarnedMinor
			result.CommissionMinor += store.CommissionMinor
			result.OrderCount += store.OrderCount
			result.EligibleAvailableMinor += store.EligibleAvailableMinor
			result.HeldMinor += store.HeldMinor
			result.SettledMinor += store.SettledMinor
		}
		if owner == fullOwner {
			result.OwnerCommissionReceivableMinor = &readback.OutstandingCommissionReceivableMinor
			result.EligibleAvailableMinor = availableBefore + readback.EligibleAvailableMinor
			result.HeldMinor = heldBefore + readback.HeldMinor
			result.SettledMinor = settledBefore + readback.SettledMinor
			result.EarnedMinor = earnedBefore + readback.EarnedMinor
		}
		if len(remaining) > 0 {
			return result, &wlt.Error{Status: 502, Code: "INVALID_FINANCE_READBACK", Message: "WLT omitted an authorized Store"}
		}
	}
	sort.Slice(result.Stores, func(i, j int) bool { return result.Stores[i].StoreID < result.Stores[j].StoreID })
	return result, nil
}

type partnerPayoutScopeStore struct {
	AttributionComplete    bool   `json:"attributionComplete"`
	StoreID                string `json:"storeId"`
	StoreName              string `json:"storeName"`
	PartnerActorID         string `json:"partnerActorId"`
	Currency               string `json:"currency"`
	EligibleAvailableMinor int64  `json:"eligibleAvailableMinor"`
	HeldMinor              int64  `json:"heldMinor"`
	PayoutReady            bool   `json:"payoutReady"`
}

func (s *BeneficiaryFinanceServer) readPartnerPayoutSummary(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" {
		writeError(w, 403, "FORBIDDEN", "an app-partner session is required")
		return
	}
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, identity.Subject, "payout_request")
	if err != nil {
		writeError(w, 500, "STORAGE_UNAVAILABLE", "payout scope is unavailable")
		return
	}
	stores, err = selectPartnerFinanceScope(stores, r.URL.Query()["storeId"])
	if err != nil {
		writeError(w, 403, "FORBIDDEN", "payout_request authority is required for every included Store")
		return
	}
	readback, err := readPartnerScopedFinance(r.Context(), s.payment, stores, "")
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	items := make([]partnerPayoutScopeStore, 0, len(readback.Stores))
	for _, store := range readback.Stores {
		items = append(items, partnerPayoutScopeStore{AttributionComplete: store.AttributionComplete, StoreID: store.StoreID, StoreName: store.StoreName, PartnerActorID: store.PartnerActorID, Currency: store.Currency, EligibleAvailableMinor: store.EligibleAvailableMinor, HeldMinor: store.HeldMinor, PayoutReady: store.PayoutReady})
	}
	writeJSON(w, 200, map[string]any{"summary": map[string]any{"attributionComplete": readback.AttributionComplete, "currency": readback.Currency, "eligibleAvailableMinor": readback.EligibleAvailableMinor, "heldMinor": readback.HeldMinor, "stores": items}})
}
