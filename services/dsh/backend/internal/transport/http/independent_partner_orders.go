package transporthttp

import (
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func independentPartnerOrderRequest(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "actor identity must come from the Partner session")
		return false
	}
	return true
}

func (s *OrderServer) listIndependentPartnerOrders(w http.ResponseWriter, r *http.Request) {
	if !independentPartnerOrderRequest(w, r) {
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	page, err := s.service.ListIndependentForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), limit, r.URL.Query().Get("cursor"))
	if err != nil {
		writeIndependentPartnerOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *OrderServer) transitionIndependentPartnerOrder(w http.ResponseWriter, r *http.Request) {
	if !independentPartnerOrderRequest(w, r) {
		return
	}
	var input postgres.IndependentPartnerOrderTransition
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.TransitionIndependentForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("orderId"), input)
	if err != nil {
		writeIndependentPartnerOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeIndependentPartnerOrderError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrIndependentPartnerOrderInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid direct pickup order operation")
	case errors.Is(err, postgres.ErrIndependentPartnerOrderConflict):
		writeError(w, http.StatusConflict, "ORDER_CONFLICT", "direct pickup order changed or transition is not permitted")
	default:
		writeOrderError(w, err)
	}
}
