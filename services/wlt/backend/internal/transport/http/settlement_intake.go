package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type settlementIntakeRequest struct {
	ActorType    string                           `json:"actorType"`
	ActorID      string                           `json:"actorId"`
	RequestedBy  string                           `json:"requestedBy"`
	AmountMode   string                           `json:"amountMode"`
	AmountMinor  *int64                           `json:"amountMinor"`
	StoreIDs     []string                         `json:"storeIds"`
	StoreAmounts []postgres.SettlementIntakeStore `json:"storeAmounts"`
}

func (s *Server) createSettlementIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input settlementIntakeRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.CreateSettlementIntake(r.Context(), s.db, postgres.SettlementIntakeInput{
		ActorType: input.ActorType, ActorID: input.ActorID, RequestedBy: input.RequestedBy,
		AmountMode: input.AmountMode, AmountMinor: input.AmountMinor,
		StoreIDs: input.StoreIDs, StoreAmounts: input.StoreAmounts,
		IdempotencyKey: idempotency, CorrelationID: correlation,
	})
	if err != nil {
		writeSettlementIntakeError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"intake": item, "idempotentReplay": replayed})
}
func (s *Server) listSettlementIntakes(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	kind, id := strings.TrimSpace(r.PathValue("actorType")), strings.TrimSpace(r.PathValue("actorId"))
	if kind != "partner" && kind != "captain" && kind != "field" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "settlement intake actor type is invalid")
		return
	}
	items, err := postgres.ListSettlementIntakes(r.Context(), s.db, kind, id, "", 50)
	if err != nil {
		writeSettlementIntakeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intakes": items})
}
func (s *Server) operatorSettlementIntakes(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	items, err := postgres.ListSettlementIntakes(r.Context(), s.db, "", "", strings.TrimSpace(r.URL.Query().Get("status")), 100)
	if err != nil {
		writeSettlementIntakeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intakes": items})
}
func (s *Server) readSettlementIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	item, err := postgres.ReadSettlementIntake(r.Context(), s.db, r.PathValue("intakeId"))
	if err != nil {
		writeSettlementIntakeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}
func (s *Server) convertSettlementIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	_, _, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		PayoutReference string `json:"payoutReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := postgres.ConvertSettlementIntake(r.Context(), s.db, r.PathValue("intakeId"), input.PayoutReference)
	if err != nil {
		writeSettlementIntakeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}
func (s *Server) cancelSettlementIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	_, _, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	item, err := postgres.CancelSettlementIntake(r.Context(), s.db, r.PathValue("intakeId"), acting, body.Reason)
	if err != nil {
		writeSettlementIntakeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}
func writeSettlementIntakeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrSettlementIntakeInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "settlement intake request is invalid")
	case errors.Is(err, postgres.ErrSettlementIntakeNotFound):
		writeError(w, http.StatusNotFound, "SETTLEMENT_INTAKE_NOT_FOUND", "settlement request was not found")
	case errors.Is(err, postgres.ErrSettlementIntakeOpen):
		writeError(w, http.StatusConflict, "SETTLEMENT_INTAKE_ALREADY_OPEN", "an active settlement request already awaits Finance")
	case errors.Is(err, postgres.ErrPartnerPayoutAttributionGap):
		writeError(w, http.StatusConflict, "PARTNER_ATTRIBUTION_REVIEW", "Store earnings require Finance attribution review")
	case errors.Is(err, postgres.ErrPayoutAmountExceeded):
		writeError(w, http.StatusConflict, "AMOUNT_EXCEEDS_ELIGIBLE", "requested amount exceeds available funds")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "this request key was used for another request")
	default:
		writeError(w, http.StatusBadGateway, "FINANCE_STORAGE_UNAVAILABLE", "settlement request could not be stored")
	}
}
