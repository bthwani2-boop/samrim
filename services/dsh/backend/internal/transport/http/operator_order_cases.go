package transporthttp

import (
	"net/http"
	"strconv"
	"strings"
)

func (s *OrderServer) listOperatorOrderCases(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	limit := 15
	if text := r.URL.Query().Get("limit"); text != "" {
		number, err := strconv.Atoi(text)
		if err != nil || number < 1 || number > 30 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be 1 to 30")
			return
		}
		limit = number
	}
	page, err := s.service.ListOrderCasesForOperator(r.Context(), r.PathValue("orderId"), actor, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, page)
}
func (s *OrderServer) openOperatorOrderCase(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason     string `json:"reason"`
		Priority   string `json:"priority"`
		NextAction string `json:"nextAction"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	corr := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	item, replay, err := s.service.OpenOrderCaseForOperator(r.Context(), r.PathValue("orderId"), actor, body.Reason, body.Priority, body.NextAction, key, corr)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"item": item, "idempotentReplay": replay})
}
func (s *OrderServer) transitionOperatorOrderCase(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("caseId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "case ID invalid")
		return
	}
	var body struct {
		Action          string `json:"action"`
		Note            string `json:"note"`
		ExpectedVersion int    `json:"expectedVersion"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	corr := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	item, replay, err := s.service.UpdateOrderCaseForOperator(r.Context(), r.PathValue("orderId"), id, actor, body.Action, body.Note, key, corr, body.ExpectedVersion)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"item": item, "idempotentReplay": replay})
}
