package transporthttp

import (
	"net/http"
	"strconv"
	"strings"
)

func (s *OrderServer) listOperatorCustomerOrders(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	operatorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	actorID := strings.TrimSpace(r.PathValue("actorId"))
	if operatorID == "" || len(operatorID) > 128 || actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "valid operator and customer actor IDs are required")
		return
	}
	rawLimit := r.URL.Query().Get("limit")
	limit := 15
	if rawLimit != "" {
		value, err := strconv.Atoi(rawLimit)
		if err != nil || value < 1 || value > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return
		}
		limit = value
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	page, err := s.service.ListForOperatorCustomer(r.Context(), actorID, operatorID, cursor, limit)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
