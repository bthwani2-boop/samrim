package transporthttp

import (
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *MarketingServer) readPublicStudioPublication(w http.ResponseWriter, r *http.Request) {
	value, err := postgres.ReadStudioPublication(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		SchemaVersion int                              `json:"schemaVersion"`
		TemplateKey   string                           `json:"templateKey"`
		Version       int                              `json:"version"`
		Palette       *postgres.StudioPublishedPalette `json:"palette"`
	}{value.SchemaVersion, value.TemplateKey, value.Version, value.Palette})
}

func (s *MarketingServer) readOperatorStudioPublication(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	value, err := postgres.ReadStudioPublication(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, value)
}

func (s *MarketingServer) readOperatorStudioPublicationHistory(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	items, err := postgres.ReadStudioPublicationHistory(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Items []postgres.StudioPublicationHistoryItem `json:"items"`
	}{items})
}

func (s *MarketingServer) setOperatorStudioPublication(w http.ResponseWriter, r *http.Request) {
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
	value, replayed, err := postgres.SetStudioPublication(
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
		Publication      postgres.StudioPublicationRecord `json:"publication"`
		IdempotentReplay bool                             `json:"idempotentReplay"`
	}{value, replayed})
}
