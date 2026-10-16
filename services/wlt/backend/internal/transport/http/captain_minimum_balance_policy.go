package http

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) readCaptainMinimumBalancePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	p, err := postgres.ReadCaptainMinimumBalancePolicy(r.Context(), s.db)
	if errors.Is(err, postgres.ErrCaptainMinimumBalancePolicyNotFound) {
		writeError(w, http.StatusNotFound, "CAPTAIN_MINIMUM_BALANCE_NOT_CONFIGURED", "captain minimum balance is not configured")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "captain policy read unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"policy": p})
}
func (s *Server) listCaptainMinimumBalancePolicyHistory(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be 1 to 100")
			return
		}
		limit = parsed
	}
	rows, err := postgres.ReadCaptainMinimumBalancePolicyHistory(r.Context(), s.db, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "captain policy history unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": rows})
}
func (s *Server) createCaptainMinimumBalancePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idem, ok := mutationHeaders(w, r)
	if !ok {
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
	p, replayed, err := postgres.CreateCaptainMinimumBalancePolicy(r.Context(), s.db, postgres.CreateCaptainMinimumBalancePolicyInput{
		MinimumAvailableMinor: input.MinimumAvailableMinor, ExpectedVersion: input.ExpectedVersion, Reason: input.Reason,
		ActingActorID: strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")), IdempotencyKey: idem, CorrelationID: correlation,
	})
	switch {
	case errors.Is(err, postgres.ErrCaptainMinimumBalancePolicyInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "captain minimum balance input is invalid")
		return
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "captain minimum balance changed; reload")
		return
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "idempotency key reused for different facts")
		return
	case err != nil:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "captain policy write unavailable")
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"policy": p, "idempotentReplay": replayed})
}
