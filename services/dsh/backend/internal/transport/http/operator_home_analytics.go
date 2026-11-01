package transporthttp

import (
	"net/http"
	"strings"
)

func (s *OrderServer) readOperatorHomeAnalytics(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	days, valid := operatorAnalyticsDays(r.URL.Query()["period"])
	if !valid {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "period must be 7d or 30d")
		return
	}
	report, err := s.service.ReadOperatorAnalyticsPeriod(r.Context(), actorID, days)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func operatorAnalyticsDays(values []string) (int, bool) {
	if len(values) == 0 || (len(values) == 1 && values[0] == "7d") {
		return 7, true
	}
	if len(values) == 1 && values[0] == "30d" {
		return 30, true
	}
	return 0, false
}
