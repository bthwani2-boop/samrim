package transporthttp

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Captain bearer identity and assignment ownership are checked independently.
func (s *CaptainServer) publishMissionLocation(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	var req struct {
		Latitude       float64   `json:"latitude"`
		Longitude      float64   `json:"longitude"`
		AccuracyMeters float64   `json:"accuracyMeters"`
		RecordedAt     time.Time `json:"recordedAt"`
		Sequence       int64     `json:"sequence"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	err := s.service.PublishMissionLocation(r.Context(), bearerToken(r), r.PathValue("assignmentId"),
		req.Latitude, req.Longitude, req.AccuracyMeters, req.RecordedAt, req.Sequence)
	switch {
	case errors.Is(err, postgres.ErrMissionLocationInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_LOCATION", "Location fix is invalid or outside the allowed time window")
	case errors.Is(err, postgres.ErrMissionLocationForbidden):
		writeError(w, http.StatusForbidden, "MISSION_NOT_ACTIVE", "Only the currently assigned Captain may publish during an active mission")
	case errors.Is(err, postgres.ErrMissionLocationStale):
		writeError(w, http.StatusConflict, "LOCATION_STALE", "A newer location is already recorded")
	case err != nil:
		writeCaptainError(w, err)
	default:
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *OrderServer) readOperatorMissionLocation(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	orderID := strings.TrimSpace(r.PathValue("orderId"))
	mission, err := s.service.ReadMissionLocationForOperator(r.Context(), orderID, actor)
	if errors.Is(err, postgres.ErrMissionLocationInvalid) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "orderId invalid")
		return
	}
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"mission": mission})
}
