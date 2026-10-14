package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

// Only an authenticated service may submit an explicitly reviewed Finance
// compensation; user-facing clients must never invoke this WLT endpoint.
func (s *Server) creditReviewedCustomerWallet(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		AmountMinor       int64  `json:"amountMinor"`
		EvidenceReference string `json:"evidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.CreditReviewedCustomerCompensation(r.Context(), s.db, postgres.CustomerWalletCompensationInput{
		CaseID: r.PathValue("caseId"), AmountMinor: input.AmountMinor,
		EvidenceReference: strings.TrimSpace(input.EvidenceReference),
		ApprovedByActorID: strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")),
		IdempotencyKey:    idempotency, CorrelationID: correlation,
	})
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrCustomerWalletCompensationInput):
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "wallet compensation request is invalid")
		case errors.Is(err, postgres.ErrOrderAdjustmentReconciliationNotFound):
			writeError(w, http.StatusNotFound, "NOT_FOUND", "canonical adjustment case was not found")
		case errors.Is(err, postgres.ErrCustomerWalletCompensationNotCollected),
			errors.Is(err, postgres.ErrCustomerWalletCompensationExceedsPayment),
			errors.Is(err, postgres.ErrCustomerWalletCompensationConflict):
			writeError(w, http.StatusConflict, "CONFLICT", "compensation is not eligible or conflicts with a previous decision")
		default:
			writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "customer wallet compensation could not be committed")
		}
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"walletCompensation": item, "idempotentReplay": replayed})
}
