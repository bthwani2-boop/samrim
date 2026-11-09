package transporthttp

import (
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
)

type independentReviewRequest struct {
	Action          string `json:"action"`
	ExpectedVersion int    `json:"expectedVersion"`
	Reason          string `json:"reason"`
}

// The Operator cannot select PUBLISHED_INDEPENDENT or a review PASSED state
// through this endpoint. These are rejection/correction transitions only.
func (s *StorePublicationServer) decideIndependentReview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	actor, ok := storeAccessOperatorActor(w, r, s.auth)
	if !ok {
		return
	}
	correlation, key, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var input independentReviewRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.DecideIndependentReview(r.Context(), r.PathValue("storeId"), actor,
		input.Action, input.Reason, input.ExpectedVersion, key, correlation)
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrIndependentPublicationReviewInvalid):
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "independent review action is invalid")
		case errors.Is(err, postgres.ErrIndependentPublicationReviewState), errors.Is(err, postgres.ErrIndependentPublicationReviewVersion):
			writeError(w, http.StatusConflict, "VERSION_CONFLICT", "independent review changed; refresh before retry")
		case errors.Is(err, postgres.ErrIndependentPublicationReviewReplay):
			writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "review key has different decision facts")
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
