package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func (s *JoiningCaseServer) readStoreRelationCommercialModelDefaults(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	defaults, err := s.service.ReadStoreRelationCommercialModelDefaultsForOperator(r.Context(), acting)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"defaults": defaults})
}

func (s *JoiningCaseServer) updateStoreRelationCommercialModelDefault(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actor, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input wlt.StoreRelationCommercialModelDefaultUpdate
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := s.service.UpdateStoreRelationCommercialModelDefaultForOperator(r.Context(), actor, input, idempotency, correlation)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"default": result, "idempotentReplay": replayed})
}
