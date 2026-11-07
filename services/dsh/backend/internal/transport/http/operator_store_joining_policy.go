package transporthttp

import (
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *OperatorPolicyServer) storeJoiningPolicyAuthorized(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.authorizeOperator(w, r) {
		return "", false
	}
	actor := r.Header.Get("X-Acting-Actor-ID")
	if !s.requireOperator(w, r.Context(), actor) || !s.requirePermission(w, r.Context(), actor, "platform_policies") {
		return "", false
	}
	return actor, true
}

func (s *OperatorPolicyServer) readOperatorStoreJoiningPolicies(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.storeJoiningPolicyAuthorized(w, r); !ok {
		return
	}
	policies, err := postgres.ReadStoreJoiningPolicies(r.Context(), s.db)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "POLICY_UNAVAILABLE", "Store joining policies are unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": policies})
}

func (s *OperatorPolicyServer) updateOperatorStoreJoiningPolicy(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.storeJoiningPolicyAuthorized(w, r)
	if !ok {
		return
	}
	headerActor, _, key, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	if headerActor != actor {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "actor mismatch")
		return
	}
	var body struct {
		EnrollmentEnabled *bool  `json:"enrollmentEnabled"`
		ExpectedVersion   int    `json:"expectedVersion"`
		Reason            string `json:"reason"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.EnrollmentEnabled == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "enrollmentEnabled is required")
		return
	}
	result, err := postgres.SetStoreJoiningPolicy(r.Context(), s.db, r.PathValue("model"), *body.EnrollmentEnabled,
		body.ExpectedVersion, actor, body.Reason, key)
	switch {
	case errors.Is(err, postgres.ErrStoreJoiningPolicyInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid Store joining policy")
	case errors.Is(err, postgres.ErrStoreJoiningPolicyVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "Store joining policy was modified; reload it")
	case errors.Is(err, postgres.ErrStoreJoiningPolicyIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "idempotency key was used for different policy facts")
	case err != nil:
		writeError(w, http.StatusServiceUnavailable, "POLICY_UNAVAILABLE", "Store joining policy could not be saved")
	default:
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"policy": result})
	}
}
