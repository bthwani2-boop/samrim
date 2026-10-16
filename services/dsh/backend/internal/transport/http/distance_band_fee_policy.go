package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"net/http"
	"strings"
)

func (s *DeliveryFeeServer) readDistanceBands(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authorization is required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if err := s.requireOperator(r.Context(), actor); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), actor) {
		return
	}
	p, err := s.payment.ReadDistanceBandFeePolicy(r.Context(), r.URL.Query().Get("serviceCityId"))
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": p})
}
func (s *DeliveryFeeServer) createDistanceBands(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authorization is required")
		return
	}
	actor, correlation, idem, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	if err := s.requireOperator(r.Context(), actor); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), actor) {
		return
	}
	var input struct {
		ServiceCityID   string                     `json:"serviceCityId"`
		DistanceBands   []wlt.DeliveryDistanceBand `json:"distanceBands"`
		ExpectedVersion int                        `json:"expectedVersion"`
		Reason          string                     `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	p, replay, err := s.payment.CreateDistanceBandFeePolicy(r.Context(), input.ServiceCityID, input.DistanceBands, input.ExpectedVersion, input.Reason, idem, correlation, actor)
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	status := http.StatusCreated
	if replay {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"policy": p, "idempotentReplay": replay})
}
