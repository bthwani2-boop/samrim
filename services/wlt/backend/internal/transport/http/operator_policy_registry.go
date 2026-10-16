package http

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	"net/http"
)

func (s *Server) readOperatorPolicyRegistry(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	out, err := postgres.ReadOperatorPolicyRegistry(r.Context(), s.db)
	if err != nil {
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "financial policy registry unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}
