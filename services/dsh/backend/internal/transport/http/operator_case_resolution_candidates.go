package transporthttp

import (
	"net/http"
	"strconv"
)

func (s *OrderServer) listOperatorCaseResolutionEvidence(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("caseId"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid case")
		return
	}
	items, err := s.service.ListOrderCaseResolutionEvidenceForOperator(r.Context(), r.PathValue("orderId"), id, actor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
