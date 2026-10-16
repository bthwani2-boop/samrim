package http

import (
	"errors"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	"net/http"
	"strings"
)

func (s *Server) readOperatorPolicyHistory(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	scope := strings.TrimSpace(r.URL.Query().Get("scopeId"))
	items, err := postgres.ReadWLTPolicyHistory(r.Context(), s.db, key, scope)
	if errors.Is(err, postgres.ErrOperatorPolicyHistoryInput) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "unknown policy or scope")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "policy events unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
