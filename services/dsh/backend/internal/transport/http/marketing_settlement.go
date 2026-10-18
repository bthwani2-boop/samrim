package transporthttp

import (
	"net/http"
	"strings"
)

// WLT owns settlement and expense. DSH only enforces operator authorization
// and forwards the single Promotion identity; it never recomputes amounts.
func (s *BeneficiaryFinanceServer) readOperatorPromotionSettlementSummary(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	promotionID := strings.TrimSpace(r.PathValue("promotionId"))
	if promotionID == "" || len(promotionID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "promotionId is invalid")
		return
	}
	summary, err := s.payment.ReadPromotionSettlementSummary(r.Context(), promotionID, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, summary)
}
