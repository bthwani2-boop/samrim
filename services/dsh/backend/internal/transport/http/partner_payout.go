package transporthttp

import (
	"net/http"
	"strings"

	integrationwlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletfacts"
)

// Partner payout requests carry an explicit Store scope and are partitioned by
// WLT into beneficiary+destination groups. DSH owns grant-based authorization
// of the requested scope; WLT owns routing, readiness, and the financial truth.

type partnerPayoutRequestCreateInput struct {
	ScopeMode    string                                    `json:"scopeMode"`
	StoreIDs     []string                                  `json:"storeIds"`
	StoreAmounts []integrationwlt.PartnerPayoutStoreAmount `json:"storeAmounts"`
}

func (s *BeneficiaryFinanceServer) createPartnerPayoutRequest(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireBeneficiarySession(w, r)
	if !ok {
		return
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" {
		writeError(w, 403, "FORBIDDEN", "an app-partner session is required")
		return
	}
	actorID := strings.TrimSpace(identity.Subject)
	correlation, idempotency, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var input partnerPayoutRequestCreateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ScopeMode = strings.ToUpper(strings.TrimSpace(input.ScopeMode))
	if (input.ScopeMode != "FULL_AVAILABLE" && input.ScopeMode != "SPECIFIED") || (input.ScopeMode == "FULL_AVAILABLE" && len(input.StoreAmounts) > 0) || (input.ScopeMode == "SPECIFIED" && len(input.StoreAmounts) == 0) {
		writeError(w, 400, "INVALID_INPUT", "FULL_AVAILABLE requires Store scope only; SPECIFIED requires per-Store amounts")
		return
	}
	requested := input.StoreIDs
	if input.ScopeMode == "SPECIFIED" {
		requested = make([]string, 0, len(input.StoreAmounts))
		amountStores := map[string]bool{}
		for i := range input.StoreAmounts {
			input.StoreAmounts[i].StoreID = strings.TrimSpace(input.StoreAmounts[i].StoreID)
			id := input.StoreAmounts[i].StoreID
			if amountStores[id] || input.StoreAmounts[i].AmountMinor <= 0 {
				writeError(w, 400, "INVALID_INPUT", "each Store requires one positive amount")
				return
			}
			amountStores[id] = true
			requested = append(requested, id)
		}
		if len(input.StoreIDs) > 0 {
			ids := map[string]bool{}
			for _, id := range input.StoreIDs {
				id = strings.TrimSpace(id)
				if !amountStores[id] {
					writeError(w, 400, "INVALID_INPUT", "Store scope must match the per-Store amounts")
					return
				}
				ids[id] = true
			}
			if len(ids) != len(amountStores) {
				writeError(w, 400, "INVALID_INPUT", "Store scope must match the per-Store amounts")
				return
			}
		}
	}
	stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, actorID, "payout_request")
	if err != nil {
		writeError(w, 500, "STORAGE_UNAVAILABLE", "payout scope is unavailable")
		return
	}
	stores, err = selectPartnerFinanceScope(stores, requested)
	if err != nil {
		writeError(w, 403, "FORBIDDEN", "payout_request authority is required for every included Store")
		return
	}
	walletOwner := stores[0].PartnerActorID
	ids := make([]string, 0, len(stores))
	for _, store := range stores {
		if store.PartnerActorID != walletOwner {
			writeError(w, 400, "MIXED_WALLET_SCOPE", "select Stores belonging to one Partner wallet per request")
			return
		}
		ids = append(ids, store.ID)
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 503, "STORAGE_UNAVAILABLE", "payout authority could not be locked")
		return
	}
	defer func() { _ = tx.Rollback() }()
	if err = postgres.LockPartnerPayoutStores(r.Context(), tx, actorID, stores); err != nil {
		writeError(w, 403, "FORBIDDEN", "payout_request authority changed; read the current Store scope")
		return
	}
	facts, err := s.partnerPayoutBeneficiaryFacts(r, actorID, walletOwner, ids)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	request, replayed, err := s.payment.CreatePartnerPayoutRequest(r.Context(), walletOwner, integrationwlt.PartnerPayoutRequestInput{ScopeMode: input.ScopeMode, StoreIDs: ids, StoreAmounts: input.StoreAmounts, BeneficiaryIdentityFacts: facts}, idempotency, correlation)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"request": request, "idempotentReplay": replayed})
}

// partnerPayoutBeneficiaryFacts resolves current verified wallet facts for the
// wallet owner and every effective staff beneficiary across the selected
// Stores, so WLT can fail closed on any destination staleness.
func (s *BeneficiaryFinanceServer) partnerPayoutBeneficiaryFacts(r *http.Request, actorID, walletOwner string, storeIDs []string) (map[string]integrationwlt.IdentityFacts, error) {
	facts := map[string]integrationwlt.IdentityFacts{}
	ownerFacts, err := walletfacts.CurrentFacts(r.Context(), s.identity, "partner", walletOwner, actorID)
	if err != nil {
		return nil, err
	}
	facts[walletOwner] = ownerFacts
	if len(storeIDs) == 0 {
		return facts, nil
	}
	readback, err := s.payment.ListPartnerStorePayoutRecipients(r.Context(), walletOwner)
	if err != nil {
		return nil, err
	}
	selected := make(map[string]struct{}, len(storeIDs))
	for _, storeID := range storeIDs {
		selected[storeID] = struct{}{}
	}
	for _, record := range readback.Recipients {
		if _, isSelected := selected[record.StoreID]; !isSelected {
			continue
		}
		if record.State != "SELECTED_VERIFIED_STAFF" || record.BeneficiaryActorID == "" || record.BeneficiaryActorID == walletOwner {
			continue
		}
		if _, resolved := facts[record.BeneficiaryActorID]; resolved {
			continue
		}
		beneficiaryFacts, err := walletfacts.CurrentFacts(r.Context(), s.identity, "partner", record.BeneficiaryActorID, actorID)
		if err != nil {
			return nil, err
		}
		facts[record.BeneficiaryActorID] = beneficiaryFacts
	}
	return facts, nil
}

func (s *BeneficiaryFinanceServer) readPartnerPayoutRequest(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	identity, err := s.identity.ReadSession(r.Context(), bearerToken(r))
	if err != nil || identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
		return
	}
	actorID := strings.TrimSpace(identity.Subject)
	pathOwner := strings.TrimSpace(r.PathValue("partnerActorId"))
	authorizedStores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, actorID, "payout_request")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "partner payout scope could not be resolved")
		return
	}
	authorizedSet := make(map[string]struct{}, len(authorizedStores))
	for _, store := range authorizedStores {
		if store.PartnerActorID == pathOwner {
			authorizedSet[store.ID] = struct{}{}
		}
	}

	if len(authorizedSet) == 0 {
		writeError(w, 403, "FORBIDDEN", "payout_request authority is required for this wallet Store scope")
		return
	}
	var request integrationwlt.PartnerPayoutRequest
	if r.PathValue("requestId") == "" {
		request, err = s.payment.ReadPartnerPayoutRequestByKey(r.Context(), pathOwner, r.URL.Query().Get("idempotencyKey"))
	} else {
		request, err = s.payment.ReadPartnerPayoutRequest(r.Context(), pathOwner, r.PathValue("requestId"))
	}
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if len(request.Stores) == 0 {
		writeError(w, 403, "FORBIDDEN", "payout Store attribution is required for a scoped readback")
		return
	}
	for _, allocation := range request.Stores {
		if _, allowed := authorizedSet[allocation.StoreID]; !allowed {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "this payout request spans Stores outside your authorized scope")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": request})
}
