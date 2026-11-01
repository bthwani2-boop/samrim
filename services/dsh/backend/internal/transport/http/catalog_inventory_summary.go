package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func inventorySummaryResponse(item postgres.CatalogInventorySummary) contract.CatalogInventorySummaryResponse {
	return contract.CatalogInventorySummaryResponse{
		Summary: contract.CatalogInventorySummary{
			StoreID:           item.StoreID,
			TotalOffers:       int(item.TotalOffers),
			PublishedOffers:   int(item.PublishedOffers),
			AvailableOffers:   int(item.AvailableOffers),
			UnavailableOffers: int(item.UnavailableOffers),
			StockoutOffers:    int(item.StockoutOffers),
		},
	}
}

func (s *CatalogServer) readPartnerStoreInventorySummary(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	item, err := s.service.ReadInventorySummaryForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, inventorySummaryResponse(item))
}

func (s *CatalogServer) readOperatorStoreInventorySummary(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	item, err := s.service.ReadInventorySummaryForOperator(r.Context(), actorID, r.PathValue("storeId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, inventorySummaryResponse(item))
}
