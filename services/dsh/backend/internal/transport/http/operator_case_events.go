package transporthttp

import (
	"net/http"
	"strconv"
	"strings"
)

// Read-only Operations audit: no idempotency or request-hash fields leave DSH.
func (s *OrderServer) listOperatorCaseEvents(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	caseID, err := strconv.ParseInt(r.PathValue("caseId"), 10, 64)
	if err != nil || caseID <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "caseId invalid")
		return
	}
	limit := 15
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 30 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be 1 to 30")
			return
		}
	}
	result, err := s.service.ListOrderCaseEventsForOperator(r.Context(), r.PathValue("orderId"), caseID, actor, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}
