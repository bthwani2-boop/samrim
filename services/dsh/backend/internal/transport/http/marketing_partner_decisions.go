package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *MarketingServer) listOperatorPartnerDecisions(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	promotionID := strings.TrimSpace(r.PathValue("promotionId"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	decision := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("decision")))
	limit := 25
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		count, err := strconv.Atoi(raw)
		if err != nil || count < 1 || count > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = count
	}
	page, err := postgres.ListOperatorPartnerDecisions(r.Context(), s.db, promotionID, cursor, decision, limit)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, page)
}
