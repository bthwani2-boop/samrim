package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
)

func (s *JoiningCaseServer) selfServiceApplication(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an authenticated customer identity is required")
		return
	}
	switch r.Method {
	case http.MethodGet:
		result, err := s.service.ReadSelfService(r.Context(), token)
		if err != nil {
			writeJoiningCaseError(w, err)
			return
		}
		s.writeResult(w, r, http.StatusOK, result)
	case http.MethodPost:
		idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
		if len(idempotency) < 8 || len(idempotency) > 128 || len(correlation) < 8 || len(correlation) > 128 ||
			r.Header.Get("X-Acting-Actor-ID") != "" || r.Header.Get("X-Actor-ID") != "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "idempotency/correlation headers are required; actor spoofing is forbidden")
			return
		}
		var input contract.CreateJoiningCaseRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		result, err := s.service.CreateSelfService(r.Context(), input, token, idempotency, correlation)
		if err != nil {
			writeJoiningCaseError(w, err)
			return
		}
		s.writeResult(w, r, responseStatus(result.Replayed), result)
	default:
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "unsupported method")
	}
}
