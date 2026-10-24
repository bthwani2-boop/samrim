package identityhttp

import (
	"net/http"
	"strings"
)

// This internal endpoint is usable only by DSH's service principal.
// DSH must not relay the result (or its absence) to untrusted clients.
func (s *Server) resolveClientShareRecipient(w http.ResponseWriter, r *http.Request, caller string) {
	if caller != "dsh" {
		writeJSON(w, http.StatusForbidden, errorBody("FORBIDDEN", "DSH service required"))
		return
	}
	phone := strings.TrimSpace(r.URL.Query().Get("phoneE164"))
	actorID, err := s.actors.ResolveClientShareRecipient(r.Context(), caller, phone)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_INPUT", "invalid share recipient"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"actorId": actorID})
}
