package transporthttp

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CaptainServer) updatePresence(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session required")
		return
	}
	var body struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	updated, err := s.service.UpdatePresence(r.Context(), bearerToken(r), body.Latitude, body.Longitude)
	if errors.Is(err, postgres.ErrCaptainPresenceNotEligible) {
		writeError(w, http.StatusConflict, "CAPTAIN_NOT_AVAILABLE", "Captain must be available for dispatch")
		return
	}
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updatedAt": updated})
}

func (s *CaptainServer) readOwnOpportunities(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session required")
		return
	}
	result, err := s.service.OpportunitiesForCaptain(r.Context(), bearerToken(r))
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *CaptainServer) readOperatorOpportunities(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" || len(actorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Operator required")
		return
	}
	result, err := s.service.OpportunitiesForOperator(r.Context(), actorID)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
