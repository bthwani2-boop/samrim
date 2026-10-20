package transporthttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) updateStoreTypeCancellationPolicy(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor header is forbidden")
		return
	}
	actor, correlation, idem, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "positive expected policy version is required")
		return
	}
	var input struct {
		Mode   string `json:"mode"`
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	updated, replayed, err := s.service.UpdateStoreTypeCancellationPolicy(r.Context(),
		actor, r.PathValue("storeTypeId"), input.Mode, input.Reason, idem, correlation, expected)
	if err != nil {
		if errors.Is(err, postgres.ErrCancellationPolicyConflict) {
			writeError(w, http.StatusConflict, "VERSION_OR_IDEMPOTENCY_CONFLICT", "policy version or retry facts changed")
		} else {
			writeCatalogError(w, err)
		}
		return
	}
	writeJSON(w, responseStatus(replayed), contract.CommercialStoreTypeResponse{StoreType: toCommercialStoreType(updated), IdempotentReplay: replayed})
}
