package transporthttp

import (
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"net/http"
	"strings"
)

func (s *OrderServer) readOperatorStageSLAPolicies(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	items, err := s.service.ListStageSLAPoliciesForOperator(r.Context(), actor)
	if err != nil {
		s.writeStageSLAPolicyError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *OrderServer) createOperatorStageSLAPolicy(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.contactOperatorActor(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	var input postgres.StageSLAPolicyInput
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replay, err := s.service.ApproveStageSLAPolicyForOperator(r.Context(), actor, input, key, correlation)
	if err != nil {
		s.writeStageSLAPolicyError(w, err)
		return
	}
	code := http.StatusCreated
	if replay {
		code = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, code, map[string]any{"policy": item, "idempotentReplay": replay})
}

func (s *OrderServer) writeStageSLAPolicyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrStageSLAPolicyInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "approved SLA policy is invalid")
	case errors.Is(err, postgres.ErrStageSLAPolicyConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "SLA policy version or request conflict")
	default:
		writeOrderError(w, err)
	}
}
