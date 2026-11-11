package transporthttp

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

// The independent merchant's private draft has no public publication or
// checkout semantics. Only a verified app-partner Identity session supplies
// the Store owner; request headers cannot override the authenticated actor.
func independentPolicyPrivateRequest(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "actor identity must come from the Partner session")
		return false
	}
	return true
}

func (s *StoreAccessServer) readIndependentCustomerPolicyForPartner(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	if !independentPolicyPrivateRequest(w, r) {
		return
	}
	record, err := s.service.ReadIndependentCustomerPolicyForOwner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeIndependentCustomerPolicyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": record, "draftOnly": true})
}

func (s *StoreAccessServer) saveIndependentCustomerPolicyDraftForPartner(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	if !independentPolicyPrivateRequest(w, r) {
		return
	}
	correlationID, key, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	if len(strings.TrimSpace(key)) < 16 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "independent policy draft requires an idempotency key of at least 16 characters")
		return
	}
	var input postgres.IndependentCustomerPolicyDraftInput
	if !decodeJSON(w, r, &input) {
		return
	}
	record, replayed, err := s.service.SaveIndependentCustomerPolicyDraftForOwner(
		r.Context(), bearerToken(r), r.PathValue("storeId"), input, key, correlationID)
	if err != nil {
		writeIndependentCustomerPolicyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": record, "draftOnly": true, "idempotentReplay": replayed})
}

func writeIndependentCustomerPolicyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storeaccess.ErrPartnerSession):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active Partner session is required")
	case errors.Is(err, postgres.ErrStoreNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "independent Store policy was not found")
	case errors.Is(err, postgres.ErrIndependentCustomerPolicyInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid merchant-authored customer policy draft")
	case errors.Is(err, postgres.ErrIndependentCustomerPolicyVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "merchant policy changed; reload before retry")
	case errors.Is(err, postgres.ErrIndependentCustomerPolicyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "key already used with different customer policy terms")
	default:
		writeStoreAccessError(w, err)
	}
}
