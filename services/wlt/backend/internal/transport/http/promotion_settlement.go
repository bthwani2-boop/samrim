package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

// The operator-facing WLT service read does not infer customer order completion
// from click counts or unfunded checkout attempts.
func (s *Server) readOperatorPromotionSettlement(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	id := strings.TrimSpace(r.PathValue("promotionId"))
	summary, err := postgres.ReadPromotionSettlementSummary(r.Context(), s.db, id)
	if errors.Is(err, postgres.ErrPromotionSettlementSummaryInput) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid promotionId is required")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "promotion settlement readback unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, summary)
}
