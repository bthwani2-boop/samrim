package transporthttp

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	orderdomain "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/order"
)

func legacyCODOperatorActor(w http.ResponseWriter, r *http.Request) (string, bool) {
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" || len(actorID) > 128 || r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "valid Finance actor is required")
		return "", false
	}
	return actorID, true
}

func legacyCODMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	actorID, ok := legacyCODOperatorActor(w, r)
	if !ok {
		return "", "", "", false
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if len(key) < 8 || len(key) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "idempotency and correlation are required")
		return "", "", "", false
	}
	return actorID, key, correlation, true
}

func (s *OrderServer) submitOperatorLegacyCODRecovery(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID, key, correlation, ok := legacyCODMutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		PaymentIntentID    string `json:"paymentIntentId"`
		EvidenceDocumentID string `json:"evidenceDocumentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	response, err := s.service.SubmitLegacyCODRecovery(r.Context(), actorID, input.PaymentIntentID, input.EvidenceDocumentID, key, correlation)
	if err != nil {
		writeLegacyCODOperatorError(w, err)
		return
	}
	status := http.StatusCreated
	if response.IdempotentReplay {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, response)
}

func (s *OrderServer) readOperatorLegacyCODRecoveryByPayment(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID, ok := legacyCODOperatorActor(w, r)
	if !ok {
		return
	}
	response, err := s.service.ReadLegacyCODRecoveryByPayment(r.Context(), actorID, r.PathValue("paymentIntentId"))
	if err != nil {
		writeLegacyCODOperatorError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func (s *OrderServer) approveOperatorLegacyCODRecovery(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID, key, correlation, ok := legacyCODMutationHeaders(w, r)
	if !ok {
		return
	}
	response, err := s.service.ApproveLegacyCODRecovery(r.Context(), actorID, r.PathValue("reviewId"), key, correlation)
	if err != nil {
		writeLegacyCODOperatorError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func writeLegacyCODOperatorError(w http.ResponseWriter, err error) {
	var remote *wlt.Error
	switch {
	case errors.Is(err, orderdomain.ErrLegacyCODRecoveryInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "legacy COD review facts are invalid")
	case errors.As(err, &remote):
		writeError(w, remote.Status, remote.Code, remote.Message)
	default:
		writeOrderError(w, err)
	}
}
