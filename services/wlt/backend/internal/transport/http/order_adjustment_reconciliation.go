package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) recordOrderAdjustmentReconciliationCase(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlationID, idempotencyKey, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input struct {
		OrderID          string `json:"orderId"`
		AdjustmentID     string `json:"adjustmentId"`
		PaymentIntentID  string `json:"paymentIntentId"`
		AdjustmentKind   string `json:"adjustmentKind"`
		RequestedByActor string `json:"requestedByActorId"`
		CustomerActorID  string `json:"customerActorId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.CustomerActorID) != actingActorID {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the acting customer must match the order customer")
		return
	}
	item, replayed, err := postgres.RecordOrderAdjustmentReconciliationCase(r.Context(), s.db, postgres.OrderAdjustmentReconciliationCaseInput{
		OrderID: input.OrderID, AdjustmentID: input.AdjustmentID, PaymentIntentID: input.PaymentIntentID,
		AdjustmentKind: input.AdjustmentKind, RequestedByActor: input.RequestedByActor, CustomerActorID: input.CustomerActorID,
		ActingActorID: actingActorID, IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		writeOrderAdjustmentReconciliationError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"reconciliationCase": item, "idempotentReplay": replayed})
}

func (s *Server) listOrderAdjustmentReconciliationCases(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	orderID := strings.TrimSpace(r.URL.Query().Get("orderId"))
	items, err := postgres.ListOrderAdjustmentReconciliationCases(r.Context(), s.db, orderID)
	if err != nil {
		writeOrderAdjustmentReconciliationError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"cases": items})
}

func writeOrderAdjustmentReconciliationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrOrderAdjustmentReconciliationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "the linked WLT payment allocation was not found")
	case errors.Is(err, postgres.ErrOrderAdjustmentReconciliationConflict):
		writeError(w, http.StatusConflict, "CONFLICT", "the WLT payment allocation or idempotent request does not match")
	case errors.Is(err, postgres.ErrOrderAdjustmentReconciliationInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order adjustment reconciliation case facts are invalid")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT order adjustment reconciliation case persistence is unavailable")
	}
}
