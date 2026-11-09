package transporthttp

import (
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
)

type independentSuspensionRequest struct {
	ExpectedVersion int    `json:"expectedVersion"`
	Reason          string `json:"reason"`
}

// Service authentication is checked before any operator ID is trusted;
// the DSH service independently verifies live Identity permissions.
func (s *StorePublicationServer) suspendIndependent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	operatorID, ok := storeAccessOperatorActor(w, r, s.auth)
	if !ok {
		return
	}
	correlation, key, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var request independentSuspensionRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.service.SuspendIndependent(r.Context(), r.PathValue("storeId"), operatorID, request.Reason, request.ExpectedVersion, key, correlation)
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrIndependentPublicationSuspendInvalid):
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "suspension requires a reason, version and idempotency")
		case errors.Is(err, postgres.ErrIndependentPublicationSuspendVersion), errors.Is(err, postgres.ErrIndependentPublicationSuspendState):
			writeError(w, http.StatusConflict, "VERSION_CONFLICT", "independent publication changed; refresh before retry")
		case errors.Is(err, postgres.ErrIndependentPublicationSuspendReplay):
			writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "suspension key was used with different facts")
		case errors.Is(err, postgres.ErrStoreNotFound):
			writeError(w, http.StatusNotFound, "NOT_FOUND", "independent Store publication was not found")
		case errors.Is(err, storepublication.ErrOperatorNotActive):
			writeError(w, http.StatusForbidden, "FORBIDDEN", "active Operator permission is required")
		default:
			writeStorePublicationError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}
