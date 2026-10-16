package http

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	"net/http"
	"strings"
)

func (s *Server) readDistanceBandFeePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	p, err := postgres.ReadDeliveryFeePolicy(r.Context(), s.db, r.URL.Query().Get("serviceCityId"))
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deliveryFeePolicyResponse{Policy: toDeliveryFeePolicy(p)})
}
func (s *Server) createDistanceBandFeePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idem, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	var input struct {
		ServiceCityID   string                          `json:"serviceCityId"`
		DistanceBands   []postgres.DeliveryDistanceBand `json:"distanceBands"`
		ExpectedVersion int                             `json:"expectedVersion"`
		Reason          string                          `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	p, replay, err := postgres.CreateDistanceBandFeePolicy(r.Context(), s.db, postgres.CreateDistanceBandFeePolicyInput{
		ServiceCityID: input.ServiceCityID, Bands: input.DistanceBands, ExpectedVersion: input.ExpectedVersion, Reason: input.Reason,
		ActingActorID: actor, IdempotencyKey: idem, CorrelationID: correlation,
	})
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	status := http.StatusCreated
	if replay {
		status = http.StatusOK
	}
	writeJSON(w, status, deliveryFeePolicyResponse{Policy: toDeliveryFeePolicy(p), IdempotentReplay: replay})
}
