package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

// DSH independently verifies the current operator's Finance permission.
func (s *Server) submitLegacyCODRecovery(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input struct {
		OrderID            string `json:"orderId"`
		PaymentIntentID    string `json:"paymentIntentId"`
		CaptainActorID     string `json:"captainActorId"`
		EvidenceDocumentID string `json:"evidenceDocumentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	review, replay, err := postgres.SubmitLegacyCODRecovery(r.Context(), s.db, postgres.LegacyCODRecoveryInput{
		OrderID: input.OrderID, PaymentIntentID: input.PaymentIntentID,
		CaptainActorID: input.CaptainActorID, EvidenceDocumentID: input.EvidenceDocumentID,
		ActorID: actorID, IdempotencyKey: idempotency, CorrelationID: correlation,
	})
	if err != nil {
		writeLegacyCODRecoveryError(w, err)
		return
	}
	status := http.StatusCreated
	if replay {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"review": review, "idempotentReplay": replay})
}

func (s *Server) readLegacyCODRecoveryByPayment(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if !s.requireOperatorID(w, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))) {
		return
	}
	review, err := postgres.ReadLegacyCODRecoveryByPayment(r.Context(), s.db, r.PathValue("paymentIntentId"))
	if err != nil {
		writeLegacyCODRecoveryError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"review": review})
}
func (s *Server) readLegacyCODRecovery(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	if !s.requireOperatorID(w, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))) {
		return
	}
	review, err := postgres.ReadLegacyCODRecovery(r.Context(), s.db, r.PathValue("reviewId"))
	if err != nil {
		writeLegacyCODRecoveryError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"review": review})
}

func (s *Server) approveLegacyCODRecovery(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlation, idempotency, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	review, replay, err := postgres.ApproveLegacyCODRecovery(r.Context(), s.db, postgres.LegacyCODRecoveryApprovalInput{
		ReviewID: r.PathValue("reviewId"), ActorID: actorID,
		IdempotencyKey: idempotency, CorrelationID: correlation,
	})
	if err != nil {
		writeLegacyCODRecoveryError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"review": review, "idempotentReplay": replay})
}

func writeLegacyCODRecoveryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrLegacyCODRecoveryInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "legacy COD review facts are invalid")
	case errors.Is(err, postgres.ErrLegacyCODRecoveryNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "legacy COD review was not found")
	case errors.Is(err, postgres.ErrLegacyCODRecoverySeparation):
		writeError(w, http.StatusForbidden, "FINANCE_REVIEW_SEPARATION_REQUIRED", "a second Finance operator must approve")
	case errors.Is(err, postgres.ErrLegacyCODRecoveryEvidence):
		writeError(w, http.StatusConflict, "FINANCE_EVIDENCE_REQUIRED", "original Finance proof must match the submitting operator")
	case errors.Is(err, postgres.ErrLegacyCODRecoveryState):
		writeError(w, http.StatusConflict, "FINANCE_REVIEW_REQUIRED", "existing payment, cover, or remittance state cannot be recovered")
	case errors.Is(err, postgres.ErrCaptainWalletInsufficientFunds):
		writeError(w, http.StatusConflict, "CAPTAIN_WALLET_INSUFFICIENT", "the original Captain must have available WLT cover before approval")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "the request conflicts with an existing recovery review")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "legacy COD review storage is unavailable")
	}
}
