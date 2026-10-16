package transporthttp

import (
	"net/http"
	"strings"
)

func (s *DeliveryFeeServer) readCaptainMinimumBalance(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service auth required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if err := s.requireOperator(r.Context(), acting); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), acting) {
		return
	}
	value, err := s.payment.ReadCaptainMinimumBalancePolicy(r.Context())
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"policy": value})
}
func (s *DeliveryFeeServer) listCaptainMinimumBalanceHistory(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service auth required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if err := s.requireOperator(r.Context(), acting); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), acting) {
		return
	}
	rows, err := s.payment.ListCaptainMinimumBalancePolicyHistory(r.Context())
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": rows})
}
func (s *DeliveryFeeServer) createCaptainMinimumBalance(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service auth required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	if err := s.requireOperator(r.Context(), acting); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), acting) {
		return
	}
	var input struct {
		MinimumAvailableMinor int64  `json:"minimumAvailableMinor"`
		ExpectedVersion       int    `json:"expectedVersion"`
		Reason                string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	p, replayed, err := s.payment.CreateCaptainMinimumBalancePolicy(r.Context(), input.MinimumAvailableMinor, input.ExpectedVersion, input.Reason, idempotency, correlation, acting)
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"policy": p, "idempotentReplay": replayed})
}
