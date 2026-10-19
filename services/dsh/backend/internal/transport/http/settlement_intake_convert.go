package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *BeneficiaryFinanceServer) cancelOperatorSettlementIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	correlation, idempotency, ok := requiredBeneficiaryFinanceMutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Reason) == "" || len(input.Reason) > 512 {
		writeError(w, 400, "INVALID_INPUT", "a cancellation reason is required")
		return
	}
	item, err := s.payment.CancelSettlementIntake(r.Context(), r.PathValue("intakeId"), input.Reason, idempotency, correlation, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}

func (s *BeneficiaryFinanceServer) convertOperatorSettlementIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	// Idempotency applies to the conversion acknowledgement; the payout
	// business key is deterministic from the intake and survives retries.
	correlation, idempotency, ok := requiredBeneficiaryFinanceMutationHeaders(w, r)
	if !ok {
		return
	}
	intake, err := s.payment.ReadSettlementIntake(r.Context(), r.PathValue("intakeId"))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if intake.Status == "CONVERTED" {
		writeJSON(w, http.StatusOK, map[string]any{"intake": intake})
		return
	}
	if intake.Status != "REQUESTED" {
		writeError(w, http.StatusConflict, "INTAKE_NOT_OPEN", "settlement request is no longer open")
		return
	}
	// Never trust the intake snapshot as permission to pay: the original
	// WLT payout path rechecks current eligible funds, destination and role.
	key := "settlement_conv_" + intake.ID
	trace := "settlement_conv_corr_" + intake.ID
	var payoutID string
	if intake.ActorType == "partner" {
		stores, err := postgres.ListPartnerFinanceStores(r.Context(), s.db, intake.RequestedBy, "payout_request")
		if err != nil {
			writeError(w, 503, "STORAGE_UNAVAILABLE", "Store permissions could not be verified")
			return
		}
		ids := make([]string, 0, len(intake.StoreAllocations))
		amounts := make([]wlt.PartnerPayoutStoreAmount, 0, len(intake.StoreAllocations))
		for _, item := range intake.StoreAllocations {
			ids = append(ids, item.StoreID)
			amounts = append(amounts, wlt.PartnerPayoutStoreAmount{StoreID: item.StoreID, AmountMinor: item.AmountMinor})
		}
		stores, err = selectPartnerFinanceScope(stores, ids)
		if err != nil || len(stores) != len(ids) {
			writeError(w, 403, "FORBIDDEN", "the originating Store authority has changed")
			return
		}
		for _, store := range stores {
			if store.PartnerActorID != intake.ActorID {
				writeError(w, 403, "FORBIDDEN", "the Store owner has changed")
				return
			}
		}
		facts, err := s.partnerPayoutBeneficiaryFacts(r, intake.RequestedBy, intake.ActorID, ids)
		if err != nil {
			writeOfficialWalletIdentityReadError(w, err)
			return
		}
		result, _, err := s.payment.CreatePartnerPayoutRequest(r.Context(), intake.ActorID, wlt.PartnerPayoutRequestInput{
			ScopeMode: "SPECIFIED", StoreIDs: ids, StoreAmounts: amounts,
			BeneficiaryIdentityFacts: facts,
		}, key, trace)
		if err != nil {
			writeWLTFinanceError(w, err)
			return
		}
		payoutID = result.ID
	} else if intake.ActorType == "captain" || intake.ActorType == "field" {
		facts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), intake.ActorType, intake.ActorID, acting)
		if err != nil {
			writeOfficialWalletIdentityReadError(w, err)
			return
		}
		amount := intake.ResolvedAmountMinor
		payout, _, err := s.payment.CreatePayoutIntent(r.Context(), intake.ActorType, intake.ActorID, "SPECIFIED", &amount, facts, key, trace)
		if err != nil {
			writeWLTFinanceError(w, err)
			return
		}
		payoutID = payout.ID
	} else {
		writeError(w, 400, "INVALID_INPUT", "unsupported beneficiary")
		return
	}
	result, err := s.payment.ConvertSettlementIntake(r.Context(), intake.ID, payoutID, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": result})
}
