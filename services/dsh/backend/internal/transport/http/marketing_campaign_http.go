package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Read and state changes use the existing Identity-backed Operator marketing
// authority. They never grant a Store a funding obligation.
func (s *MarketingServer) readOperatorMarketingCampaign(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	id := strings.TrimSpace(r.PathValue("campaignId"))
	campaign, err := postgres.ReadMarketingCampaign(r.Context(), s.db, id)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Campaign postgres.MarketingCampaignRecord `json:"campaign"`
	}{campaign})
}

func (s *MarketingServer) setOperatorMarketingCampaignState(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	actor, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var body struct {
		State string `json:"state"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	campaign, replayed, err := postgres.SetMarketingCampaignState(
		r.Context(), s.db, r.PathValue("campaignId"), body.State,
		actor, correlation, idempotency, expected)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, responseStatus(replayed), struct {
		Campaign         postgres.MarketingCampaignRecord `json:"campaign"`
		IdempotentReplay bool                             `json:"idempotentReplay"`
	}{campaign, replayed})
}

func (s *MarketingServer) listOperatorMarketingCampaigns(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	q := r.URL.Query()
	limit := 25
	if raw := q.Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			writeMarketingError(w, postgres.ErrMarketingCampaignInvalid)
			return
		}
		limit = value
	}
	items, err := postgres.ListOperatorMarketingCampaigns(r.Context(), s.db, q.Get("state"), q.Get("cursor"), limit)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, items)
}

func (s *MarketingServer) createOperatorMarketingCampaign(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	actor, _, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var body struct {
		NameAr           string `json:"nameAr"`
		Objective        string `json:"objective"`
		BudgetLimitMinor int64  `json:"budgetLimitMinor"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, replayed, err := postgres.CreateOperatorMarketingCampaign(r.Context(), s.db, postgres.MarketingCampaignInput{
		NameAr: body.NameAr, Objective: body.Objective, BudgetLimitMinor: body.BudgetLimitMinor,
		CreatedByActorID: actor,
	}, idempotency)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, responseStatus(replayed), struct {
		Campaign         postgres.MarketingCampaignRecord `json:"campaign"`
		IdempotentReplay bool                             `json:"idempotentReplay"`
	}{item, replayed})
}
