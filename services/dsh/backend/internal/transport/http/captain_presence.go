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
		writeError(w, http.StatusConflict, "CAPTAIN_NOT_AVAILABLE", "Captain is not available or in custody")
		return
	}
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updatedAt": updated})
}

func (s *CaptainServer) readPresenceHeatmap(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Operator required")
		return
	}
	if mode == "" {
		mode = "balanced"
	}
	if mode != "wide" && mode != "balanced" && mode != "detailed" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Invalid heatmap mode")
		return
	}
	cells, err := s.service.PresenceHeatmap(r.Context(), actorID, mode)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cells": cells, "mode": mode, "minimumCount": 3, "freshWithinMinutes": 15})
}
