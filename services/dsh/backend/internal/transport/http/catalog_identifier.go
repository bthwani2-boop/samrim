package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) registerCatalogIdentifier(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/catalog/identifiers/resolve", s.resolvePartnerCatalogIdentifier)
}

func (s *CatalogServer) resolvePartnerCatalogIdentifier(w http.ResponseWriter, r *http.Request) {
	var input contract.CatalogIdentifierResolveRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.StoreID) == "" || strings.TrimSpace(input.IdentifierValue) == "" || len(input.IdentifierValue) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId and a valid identifierValue are required")
		return
	}
	resolution, err := s.service.ResolveCatalogIdentifierForPartner(r.Context(), bearerToken(r), input.StoreID, input.IdentifierValue)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeCatalogIdentifierResolution(w, resolution)
}

func writeCatalogIdentifierResolution(w http.ResponseWriter, item postgres.CatalogIdentifierResolution) {
	resolution := contract.CatalogIdentifierResolution{
		Outcome: item.Outcome, StoreID: item.StoreID, ProductID: item.ProductID, VariantID: item.VariantID,
		StoreOfferID: item.StoreOfferID, Scope: item.Scope, ProductName: item.ProductName,
		VariantTitle: item.VariantTitle, MeasurementKind: contract.MeasurementKind(item.MeasurementKind),
		PublicationState: item.PublicationState,
	}
	writeJSON(w, http.StatusOK, contract.CatalogIdentifierResolveResponse{Resolution: resolution})
}
