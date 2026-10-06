package transporthttp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletfacts"
	integrationwlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

// Partner payout requests carry an explicit Store scope and are partitioned by
// WLT into beneficiary+destination groups. DSH owns grant-based authorization
// of the requested scope; WLT owns routing, readiness, and the financial truth.

type partnerPayoutRequestCreateInput struct {
	ScopeMode    string                                    `json:"scopeMode"`
	StoreIDs     []string                                  `json:"storeIds"`
	StoreAmounts []integrationwlt.PartnerPayoutStoreAmount `json:"storeAmounts"`
}

// ListPartnerPayoutAuthorizedStoreIDs resolves the Store scope a partner actor
// may request payouts for: owned Stores plus active grants carrying the
// payout_request permission.
func ListPartnerPayoutAuthorizedStoreIDs(ctx context.Context, db *sql.DB, actorID string) ([]string, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return nil, postgres.ErrStoreAccessConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM dsh.stores WHERE partner_actor_id=$1
		UNION SELECT store_id FROM dsh.store_access_grants WHERE delegate_actor_id=$1 AND state='active' AND 'payout_request'=ANY(permissions)`, actorID, actorID)
	if err != nil {
		return nil, fmt.Errorf("resolve partner payout scope: %w", err)
	}
	defer rows.Close()
	storeIDs := make([]string, 0, 4)
	for rows.Next() {
		var storeID string
		if err := rows.Scan(&storeID); err != nil {
			return nil, err
		}
		storeIDs = append(storeIDs, storeID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return storeIDs, nil
}

// PartnerHoldsPayoutGrantUnder reports whether the delegate holds an active
// payout_request grant under the given owner Partner.
func PartnerHoldsPayoutGrantUnder(ctx context.Context, db *sql.DB, delegateActorID, ownerActorID string) (bool, error) {
	delegateActorID, ownerActorID = strings.TrimSpace(delegateActorID), strings.TrimSpace(ownerActorID)
	if db == nil || delegateActorID == "" || ownerActorID == "" || len(delegateActorID) > 128 || len(ownerActorID) > 128 {
		return false, postgres.ErrStoreAccessConflict
	}
	var granted bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM dsh.store_access_grants
		WHERE delegate_actor_id=$1 AND owner_partner_actor_id=$2 AND state='active' AND 'payout_request'=ANY(permissions)
	)`, delegateActorID, ownerActorID).Scan(&granted); err != nil {
		return false, fmt.Errorf("resolve partner payout grant: %w", err)
	}
	return granted, nil
}

func (s *BeneficiaryFinanceServer) createPartnerPayoutRequest(w http.ResponseWriter, r *http.Request) {
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
	correlation, idempotency, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var input partnerPayoutRequestCreateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ScopeMode = strings.ToUpper(strings.TrimSpace(input.ScopeMode))
	if input.ScopeMode != "FULL_AVAILABLE" && input.ScopeMode != "SPECIFIED" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "scopeMode must be FULL_AVAILABLE or SPECIFIED")
		return
	}

	authorized, err := ListPartnerPayoutAuthorizedStoreIDs(r.Context(), s.db, actorID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "partner payout scope could not be resolved")
		return
	}
	if len(authorized) == 0 {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "payout_request authority is not granted for any Store")
		return
	}
	authorizedSet := make(map[string]struct{}, len(authorized))
	for _, storeID := range authorized {
		authorizedSet[storeID] = struct{}{}
	}
	ownsAnyStore := false
	for _, storeID := range authorized {
		store, err := postgres.ReadStore(r.Context(), s.db, storeID)
		if err == nil && store.PartnerActorID == actorID {
			ownsAnyStore = true
			break
		}
	}

	requested := make([]string, 0, len(input.StoreIDs))
	for _, storeID := range input.StoreIDs {
		storeID = strings.TrimSpace(storeID)
		if storeID == "" {
			continue
		}
		if _, allowed := authorizedSet[storeID]; !allowed {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "payout_request authority is not granted for one of the requested Stores")
			return
		}
		requested = append(requested, storeID)
	}
	for _, storeAmount := range input.StoreAmounts {
		storeID := strings.TrimSpace(storeAmount.StoreID)
		if _, allowed := authorizedSet[storeID]; !allowed {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "payout_request authority is not granted for one of the requested Stores")
			return
		}
		requested = append(requested, storeID)
	}

	// Resolve the wallet owner for the request scope. One request pays one
	// Partner wallet; a mixed-owner scope fails closed.
	walletOwner, err := s.resolvePartnerPayoutWalletOwner(r, actorID, ownsAnyStore, requested)
	if err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the requested payout scope spans more than one Partner wallet or grants no authority")
		return
	}

	// FULL_AVAILABLE for the wallet owner covers the whole wallet scope
	// (including owner-routed legacy attribution); any narrowing or delegate
	// request carries its explicit Store scope.
	wltInput := integrationwlt.PartnerPayoutRequestInput{ScopeMode: input.ScopeMode}
	if walletOwner != actorID || len(requested) > 0 {
		narrowed := make([]string, 0, len(requested))
		seen := map[string]struct{}{}
		for _, storeID := range requested {
			if _, duplicate := seen[storeID]; duplicate {
				continue
			}
			seen[storeID] = struct{}{}
			narrowed = append(narrowed, storeID)
		}
		if len(narrowed) == 0 {
			// A delegated request without an explicit scope covers exactly the
			// delegate's authorized grant scope.
			narrowed = authorized
		}
		wltInput.StoreIDs = narrowed
	}
	if input.ScopeMode == "SPECIFIED" {
		if len(input.StoreAmounts) == 0 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "SPECIFIED requires storeAmounts")
			return
		}
		wltInput.StoreAmounts = input.StoreAmounts
	}

	facts, err := s.partnerPayoutBeneficiaryFacts(r, actorID, walletOwner, wltInput.StoreIDs)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	wltInput.BeneficiaryIdentityFacts = facts

	request, replayed, err := s.payment.CreatePartnerPayoutRequest(r.Context(), walletOwner, wltInput, idempotency, correlation)
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

// resolvePartnerPayoutWalletOwner returns the single Partner wallet owner for
// the requested scope. The actor itself qualifies when it owns a Store;
// otherwise the granted Stores' common owner is used.
func (s *BeneficiaryFinanceServer) resolvePartnerPayoutWalletOwner(r *http.Request, actorID string, ownsAnyStore bool, requested []string) (string, error) {
	if ownsAnyStore {
		return actorID, nil
	}
	if len(requested) == 0 {
		return "", errors.New("no authorized scope")
	}
	owner := ""
	for _, storeID := range requested {
		ownerPartnerActorID := ""
		store, err := postgres.ReadStore(r.Context(), s.db, storeID)
		if err == nil {
			ownerPartnerActorID = store.PartnerActorID
		}
		if ownerPartnerActorID == "" {
			return "", errors.New("store owner could not be resolved")
		}
		if owner == "" {
			owner = ownerPartnerActorID
		} else if owner != ownerPartnerActorID {
			return "", errors.New("mixed wallet owners")
		}
	}
	if owner == "" {
		return "", errors.New("no wallet owner")
	}
	return owner, nil
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
	// Readback authorization: the wallet owner, or a delegate holding an active
	// payout_request grant under that owner.
	if pathOwner != actorID {
		granted, err := PartnerHoldsPayoutGrantUnder(r.Context(), s.db, actorID, pathOwner)
		if err != nil || !granted {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "this payout request readback requires authority under the wallet owner")
			return
		}
	}
	request, err := s.payment.ReadPartnerPayoutRequest(r.Context(), pathOwner, r.PathValue("requestId"))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if pathOwner != actorID {
		// A delegate may read a request they are authorized for: every Store in
		// the request allocation must sit inside their granted scope.
		authorizedIDs, err := ListPartnerPayoutAuthorizedStoreIDs(r.Context(), s.db, actorID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "partner payout scope could not be resolved")
			return
		}
		authorizedSet := make(map[string]struct{}, len(authorizedIDs))
		for _, storeID := range authorizedIDs {
			authorizedSet[storeID] = struct{}{}
		}
		for _, allocation := range request.Stores {
			if _, allowed := authorizedSet[allocation.StoreID]; !allowed {
				writeError(w, http.StatusForbidden, "FORBIDDEN", "this payout request spans Stores outside your authorized scope")
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": request})
}
