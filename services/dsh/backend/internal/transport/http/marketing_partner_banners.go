package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *MarketingServer) listPublicStoreBanners(w http.ResponseWriter, r *http.Request) {
	storeID := strings.TrimSpace(r.PathValue("storeId"))
	cityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if storeID == "" || cityID == "" || len(storeID) > 128 || len(cityID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store and Service City are required")
		return
	}
	items, err := postgres.ListPublishedStoreBanners(r.Context(), s.db, storeID, cityID)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.PublicDiscoveryContentView, 0, len(items))
	for _, item := range items {
		values = append(values, toPublicDiscoveryContentView(item))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.DiscoveryContentListResponse{Items: values})
}

func (s *MarketingServer) listPartnerStoreBanners(w http.ResponseWriter, r *http.Request) {
	storeID := r.PathValue("storeId")
	if _, err := s.requirePartnerStorePromotionAuthority(r.Context(), bearerToken(r), storeID); err != nil {
		writeMarketingError(w, err)
		return
	}
	if len(r.URL.Query()["cursor"]) > 1 || len(r.URL.Query()["limit"]) > 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor or limit provided more than once")
		return
	}
	limit := 60
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		var parseErr error
		limit, parseErr = strconv.Atoi(raw)
		if parseErr != nil || limit < 1 || limit > 60 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be 1..60")
			return
		}
	}
	items, nextCursor, err := postgres.PagePartnerStoreBanners(r.Context(), s.db, storeID, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.DiscoveryContentView, 0, len(items))
	for _, item := range items {
		values = append(values, toDiscoveryContentView(item))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.OperatorDiscoveryContentRegistryResponse{Items: values, Limit: limit, NextCursor: nextCursor})
}

func (s *MarketingServer) setPartnerStoreBannerVisibility(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	storeID := r.PathValue("storeId")
	actorID, err := s.requirePartnerStorePromotionAuthority(r.Context(), bearerToken(r), storeID)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	var input struct {
		Enabled         *bool `json:"enabled"`
		ExpectedVersion int   `json:"expectedVersion"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Enabled == nil || input.ExpectedVersion < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "enabled and positive expectedVersion are required")
		return
	}
	item, replayed, err := postgres.SetPartnerStoreBannerEnabled(r.Context(), s.db, storeID, r.PathValue("contentId"), actorID, *input.Enabled, input.ExpectedVersion, idempotency, correlation)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.DiscoveryContentResponse{Content: toDiscoveryContentView(item), IdempotentReplay: replayed})
}

// Partner visibility never grants Operator publication authority.
