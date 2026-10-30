package transporthttp

import (
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func writeCancellationRequestError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCancellationRequestNotFound):
		writeError(w, 404, "NOT_FOUND", "cancellation request or owned Order not found")
	case errors.Is(err, postgres.ErrCancellationRequestConflict):
		writeError(w, 409, "CONFLICT", "cancellation request already pending, completed or conflicting")
	case errors.Is(err, postgres.ErrCancellationRequestInvalid):
		writeError(w, 400, "INVALID_INPUT", "invalid cancellation request reason or attribution")
	default:
		writeOrderError(w, err)
	}
}
func (s *OrderServer) createClientCancellationRequest(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, 401, "UNAUTHENTICATED", "client session required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, 400, "INVALID_INPUT", "client actor comes from session")
		return
	}
	idem, correlation := strings.TrimSpace(r.Header.Get("Idempotency-Key")), strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if len(idem) < 8 || len(idem) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		writeError(w, 400, "INVALID_INPUT", "idempotency and correlation required")
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if utf8.RuneCountInString(input.Reason) < 12 || utf8.RuneCountInString(input.Reason) > 500 {
		writeError(w, 400, "INVALID_INPUT", "reason length must be 12..500")
		return
	}
	record, replayed, err := s.service.CreateClientCancellationRequest(r.Context(), bearerToken(r), r.PathValue("orderId"), input.Reason, idem, correlation)
	if err != nil {
		writeCancellationRequestError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"request": record, "idempotentReplay": replayed})
}
func (s *OrderServer) readClientCancellationRequest(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, 401, "UNAUTHENTICATED", "client session required")
		return
	}
	record, err := s.service.ReadClientCancellationRequest(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeCancellationRequestError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": record})
}
func (s *OrderServer) listOperatorCancellationRequests(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, 401, "UNAUTHENTICATED", "service authentication required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" || r.Header.Get("X-Actor-ID") != "" {
		writeError(w, 400, "INVALID_INPUT", "operator actor required")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			writeError(w, 400, "INVALID_INPUT", "invalid limit")
			return
		}
		limit = n
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 512 {
		writeError(w, 400, "INVALID_INPUT", "invalid cancellation queue cursor")
		return
	}
	page, err := s.service.ListCancellationRequestsForOperator(r.Context(), actor, limit, cursor)
	if err != nil {
		writeCancellationRequestError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
func (s *OrderServer) declineOperatorCancellationRequest(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, 401, "UNAUTHENTICATED", "service authentication required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" || r.Header.Get("X-Actor-ID") != "" {
		writeError(w, 400, "INVALID_INPUT", "operator actor required")
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	record, err := s.service.DeclineCancellationRequestForOperator(r.Context(), actor, r.PathValue("requestId"), input.Reason)
	if err != nil {
		writeCancellationRequestError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": record})
}
