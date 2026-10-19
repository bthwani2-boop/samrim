package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type settlementIntakeInput struct {
	AmountMode  string `json:"amountMode"`
	AmountMinor *int64 `json:"amountMinor"`
}

func (s *BeneficiaryFinanceServer) createOwnSettlementIntake(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role != "field" && identity.Role != "captain" {
		writeError(w, 403, "FORBIDDEN", "only field and BThwani captain sessions may submit individual settlement requests")
		return
	}
	correlation, idempotency, ok := requiredBeneficiaryFinanceMutationHeaders(w, r)
	if !ok {
		return
	}
	var input settlementIntakeInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := s.payment.CreateSettlementIntake(r.Context(), wlt.SettlementIntakeInput{
		ActorType: identity.Role, ActorID: identity.Subject, RequestedBy: identity.Subject,
		AmountMode: input.AmountMode, AmountMinor: input.AmountMinor,
	}, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"intake": item, "idempotentReplay": replayed})
}
func (s *BeneficiaryFinanceServer) listOwnSettlementIntakes(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role != "field" && identity.Role != "captain" {
		writeError(w, 403, "FORBIDDEN", "this beneficiary must use Store-scoped settlement")
		return
	}
	items, err := s.payment.ListSettlementIntakes(r.Context(), identity.Role, identity.Subject)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intakes": items})
}
func (s *BeneficiaryFinanceServer) createPartnerSettlementIntake(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" {
		writeError(w, 403, "FORBIDDEN", "a Partner session is required")
		return
	}
	correlation, idempotency, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var input partnerPayoutRequestCreateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ScopeMode = strings.ToUpper(strings.TrimSpace(input.ScopeMode))
	requested := input.StoreIDs
	if input.ScopeMode == "SPECIFIED" {
		requested = make([]string, 0, len(input.StoreAmounts))
		for _, entry := range input.StoreAmounts {
			requested = append(requested, entry.StoreID)
		}
	} else if input.ScopeMode != "FULL_AVAILABLE" || len(input.StoreAmounts) > 0 {
		writeError(w, 400, "INVALID_INPUT", "settlement request Store amounts or mode are invalid")
		return
	}
	if len(requested) == 0 || len(requested) > 1000 {
		writeError(w, 400, "INVALID_INPUT", "select at least one Store")
		return
	}
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, identity.Subject, "payout_request")
	if err != nil {
		writeError(w, 503, "STORAGE_UNAVAILABLE", "partner Store permissions unavailable")
		return
	}
	stores, err = selectPartnerFinanceScope(stores, requested)
	if err != nil {
		writeError(w, 403, "FORBIDDEN", "payout_request permission required for each Store")
		return
	}
	owner := stores[0].PartnerActorID
	ids := make([]string, 0, len(stores))
	for _, store := range stores {
		if store.PartnerActorID != owner {
			writeError(w, 400, "MIXED_WALLET_SCOPE", "select Stores from one partner wallet")
			return
		}
		ids = append(ids, store.ID)
	}
	allocations := make([]wlt.SettlementIntakeStore, 0, len(input.StoreAmounts))
	for _, entry := range input.StoreAmounts {
		allocations = append(allocations, wlt.SettlementIntakeStore{StoreID: entry.StoreID, AmountMinor: entry.AmountMinor})
	}
	item, replayed, err := s.payment.CreateSettlementIntake(r.Context(), wlt.SettlementIntakeInput{
		ActorType: "partner", ActorID: owner, RequestedBy: identity.Subject,
		AmountMode: input.ScopeMode, StoreIDs: ids, StoreAmounts: allocations,
	}, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"intake": item, "idempotentReplay": replayed})
}
func (s *BeneficiaryFinanceServer) listPartnerSettlementIntakes(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" {
		writeError(w, 403, "FORBIDDEN", "Partner session required")
		return
	}
	// Resolve the canonical wallet owners through current Store grants.
	// A delegated staff member may read only intakes they submitted and whose
	// entire Store scope they still have authority to request.
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, identity.Subject, "payout_request")
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "STORAGE_UNAVAILABLE", "Partner Store grants cannot be read")
		return
	}
	owners := make(map[string]map[string]bool)
	for _, store := range stores {
		if owners[store.PartnerActorID] == nil {
			owners[store.PartnerActorID] = map[string]bool{}
		}
		owners[store.PartnerActorID][store.ID] = true
	}
	items := make([]wlt.SettlementIntake, 0)
	for owner, granted := range owners {
		ownerItems, err := s.payment.ListSettlementIntakes(r.Context(), "partner", owner)
		if err != nil {
			writeWLTFinanceError(w, err)
			return
		}
		for _, item := range ownerItems {
			if owner == identity.Subject {
				items = append(items, item)
				continue
			}
			if item.RequestedBy != identity.Subject {
				continue
			}
			allGranted := len(item.StoreAllocations) > 0
			for _, allocation := range item.StoreAllocations {
				if !granted[allocation.StoreID] {
					allGranted = false
					break
				}
			}
			if allGranted {
				items = append(items, item)
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intakes": items})
}
func (s *BeneficiaryFinanceServer) listOperatorSettlementIntakes(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	items, err := s.payment.ListOperatorSettlementIntakes(r.Context(), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intakes": items})
}
