package transporthttp

import (
	"net/http"
	"strconv"
	"strings"
)

func (s *OrderServer) contactOperatorActor(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication required")
		return "", false
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if len(actor) == 0 || len(actor) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator actor is required")
		return "", false
	}
	return actor, true
}

func (s *OrderServer) readOperatorContactReview(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	orderID := strings.TrimSpace(r.PathValue("orderId"))
	if len(orderID) == 0 || len(orderID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "orderId is invalid")
		return
	}
	review, err := s.service.ReadCustomerContactForOperator(r.Context(), orderID, actor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"review": review})
}

func (s *OrderServer) recordOperatorContactReview(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	orderID := strings.TrimSpace(r.PathValue("orderId"))
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	corr := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	var body struct {
		Decision        string `json:"decision"`
		ExpectedVersion int    `json:"expectedVersion"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	review, replay, err := s.service.RecordCustomerContactForOperator(
		r.Context(), orderID, actor, body.Decision, key, corr, body.ExpectedVersion,
	)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"review": review, "idempotentReplay": replay})
}

func (s *OrderServer) listOperatorCustomerContactQueue(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	limit := 10
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be 1..50")
			return
		}
		limit = parsed
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor too long")
		return
	}
	page, err := s.service.ListPendingCustomerContactsForOperator(r.Context(), actor, limit, cursor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
