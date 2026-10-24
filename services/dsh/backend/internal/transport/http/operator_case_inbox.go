package transporthttp

import (
	"net/http"
	"strconv"
	"strings"
)

func (s *OrderServer) listOperatorCaseInbox(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	limit := 15
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 30 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be 1 to 30")
			return
		}
		limit = n
	}
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = "all"
	}
	cases, err := s.service.ListOpenCasesForOperator(r.Context(), actor, scope, limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, cases)
}
