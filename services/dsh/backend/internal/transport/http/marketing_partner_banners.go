package transporthttp

import (
	"net/http"
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
	items, err := postgres.ListPartnerStoreBanners(r.Context(), s.db, storeID)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.DiscoveryContentView, 0, len(items))
	for _, item := range items {
		values = append(values, toDiscoveryContentView(item))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, contract.OperatorDiscoveryContentRegistryResponse{Items: values, Limit: len(values)})
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
