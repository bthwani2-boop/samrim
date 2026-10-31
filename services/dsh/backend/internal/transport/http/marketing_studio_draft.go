package transporthttp

import (
	"encoding/json"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *MarketingServer) readOperatorStudioDraft(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	value, err := postgres.ReadStudioDraft(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, value)
}

func (s *MarketingServer) setOperatorStudioDraft(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	actor, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Document json.RawMessage `json:"document"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	value, replayed, err := postgres.SetStudioDraft(r.Context(), s.db, input.Document, expected, actor, correlation, idempotency)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Draft            postgres.StudioDraftRecord `json:"draft"`
		IdempotentReplay bool                       `json:"idempotentReplay"`
	}{value, replayed})
}
