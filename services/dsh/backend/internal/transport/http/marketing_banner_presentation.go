package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"net/http"
)

func (s *MarketingServer) readPublicBannerPresentation(w http.ResponseWriter, r *http.Request) {
	value, err := postgres.ReadBannerPresentation(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Placement       string `json:"placement"`
		Mode            string `json:"mode"`
		IntervalSeconds int    `json:"intervalSeconds"`
		Version         int    `json:"version"`
	}{value.Placement, value.Mode, value.IntervalSeconds, value.Version})
}

func (s *MarketingServer) readOperatorBannerPresentation(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	value, err := postgres.ReadBannerPresentation(r.Context(), s.db)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, value)
}

func (s *MarketingServer) setOperatorBannerPresentation(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	actor, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input struct {
		Mode            string `json:"mode"`
		IntervalSeconds int    `json:"intervalSeconds"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	value, replayed, err := postgres.SetBannerPresentation(r.Context(), s.db, input.Mode, input.IntervalSeconds, expected, actor, correlation, idempotency)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Presentation     postgres.BannerPresentation `json:"presentation"`
		IdempotentReplay bool                        `json:"idempotentReplay"`
	}{value, replayed})
}
