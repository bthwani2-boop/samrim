package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"net/http"
)

func (s *MarketingServer) readPublicStudioLayout(w http.ResponseWriter, r *http.Request) {
	value, err := postgres.ReadStudioLayoutPublication(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	// Public output deliberately omits the operator identity and draft metadata.
	writeJSON(w, http.StatusOK, struct {
		SchemaVersion int    `json:"schemaVersion"`
		TemplateKey   string `json:"templateKey"`
		Version       int    `json:"version"`
		Document      any    `json:"document"`
	}{value.SchemaVersion, value.TemplateKey, value.Version, value.Document})
}

func (s *MarketingServer) readOperatorStudioLayout(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	value, err := postgres.ReadStudioLayoutPublication(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, value)
}

func (s *MarketingServer) readOperatorStudioLayoutHistory(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	items, err := postgres.ReadStudioLayoutPublicationHistory(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Items []postgres.StudioLayoutHistoryItem `json:"items"`
	}{items})
}

func (s *MarketingServer) setOperatorStudioLayout(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	actor, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Action                   string `json:"action"`
		ExpectedDraftVersion     int    `json:"expectedDraftVersion"`
		TargetPublicationVersion int    `json:"targetPublicationVersion"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	value, replayed, err := postgres.SetStudioLayoutPublication(
		r.Context(), s.db, input.Action, expected,
		input.ExpectedDraftVersion, input.TargetPublicationVersion,
		actor, correlation, idempotency,
	)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Publication      postgres.StudioLayoutPublicationRecord `json:"publication"`
		IdempotentReplay bool                                   `json:"idempotentReplay"`
	}{value, replayed})
}
