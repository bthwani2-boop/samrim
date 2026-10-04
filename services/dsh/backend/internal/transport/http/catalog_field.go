package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) registerFieldCatalog(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/catalog/identifiers/resolve", s.resolvePartnerCatalogIdentifier)
	mux.HandleFunc("POST /dsh/field/catalog/identifiers/resolve", s.resolveFieldCatalogIdentifier)
	mux.HandleFunc("GET /dsh/field/joining-cases/{caseId}/catalog", s.readFieldJoiningCaseCatalog)
	mux.HandleFunc("POST /dsh/field/joining-cases/{caseId}/catalog/products", s.createFieldInitialCatalogProduct)
	mux.HandleFunc("POST /dsh/field/joining-cases/{caseId}/catalog/offers", s.createFieldInitialCatalogOffer)
	mux.HandleFunc("PATCH /dsh/field/joining-cases/{caseId}/catalog/offers/{offerId}", s.updateFieldInitialCatalogOffer)
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

func (s *CatalogServer) resolveFieldCatalogIdentifier(w http.ResponseWriter, r *http.Request) {
	var input contract.FieldCatalogIdentifierResolveRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.JoiningCaseID) == "" || strings.TrimSpace(input.IdentifierValue) == "" || len(input.IdentifierValue) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "joiningCaseId and a valid identifierValue are required")
		return
	}
	resolution, err := s.service.ResolveCatalogIdentifierForField(r.Context(), bearerToken(r), input.JoiningCaseID, input.IdentifierValue)
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

func (s *CatalogServer) readFieldJoiningCaseCatalog(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Field session is required")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 160 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "q must not exceed 160 characters")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "offer cursor is invalid")
		return
	}
	result, err := s.service.ListFieldCatalog(r.Context(), bearerToken(r), r.PathValue("caseId"), query, limit, cursor)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	products := make([]contract.CatalogProduct, 0, len(result.Products))
	for _, product := range result.Products {
		products = append(products, toCatalogProduct(product))
	}
	offers := make([]contract.CatalogStoreOffer, 0, len(result.Offers.Offers))
	for _, offer := range result.Offers.Offers {
		offers = append(offers, toStoreOffer(offer))
	}
	writeJSON(w, http.StatusOK, contract.FieldCatalogReadResponse{JoiningCaseID: result.Scope.JoiningCaseID, StoreID: result.Scope.StoreID, VerticalID: result.Scope.VerticalID, Products: products, Offers: offers, NextCursor: result.Offers.NextCursor})
}

func (s *CatalogServer) createFieldInitialCatalogProduct(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateFieldCatalogProductRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateFieldCatalogProduct(r.Context(), bearerToken(r), r.PathValue("caseId"), postgres.CatalogProductInput{
		CanonicalName: input.CanonicalName, Description: input.Description, Brand: optionalRequestString(input.Brand),
		VariantTitle: input.VariantTitle, MeasurementKind: string(input.MeasurementKind), BaseUnit: string(input.BaseUnit),
		IdentifierType: strings.ToUpper(strings.TrimSpace(input.IdentifierType)), IdentifierValue: strings.TrimSpace(input.IdentifierValue),
	}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) createFieldInitialCatalogOffer(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateStoreOfferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateFieldCatalogOffer(r.Context(), bearerToken(r), r.PathValue("caseId"), postgres.CatalogOfferInput{
		VariantID: input.VariantID, PriceMinor: int64(input.PriceMinor), QuantityPolicy: input.QuantityPolicy,
		QuantityMinBaseUnits: int64(input.QuantityMinBaseUnits), QuantityMaxBaseUnits: int64(input.QuantityMaxBaseUnits),
		QuantityStepBaseUnits: int64(input.QuantityStepBaseUnits), PricingBasis: input.PricingBasis,
		PricingUnitBaseUnits: int64(input.PricingUnitBaseUnits), InventoryPolicy: input.InventoryPolicy,
		InventoryOnHandBaseUnits: int64(input.InventoryOnHandBaseUnits),
	}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffer(w, responseStatus(result.Replayed), result)
}

func (s *CatalogServer) updateFieldInitialCatalogOffer(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateStoreOfferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateFieldCatalogOffer(r.Context(), bearerToken(r), r.PathValue("caseId"), r.PathValue("offerId"), postgres.CatalogOfferUpdateInput{
		PriceMinor: int64(input.PriceMinor), Availability: input.Availability, PublicationState: strings.ToLower(string(input.PublicationState)),
		QuantityPolicy: input.QuantityPolicy, QuantityMinBaseUnits: int64(input.QuantityMinBaseUnits),
		QuantityMaxBaseUnits: int64(input.QuantityMaxBaseUnits), QuantityStepBaseUnits: int64(input.QuantityStepBaseUnits),
		PricingBasis: input.PricingBasis, PricingUnitBaseUnits: int64(input.PricingUnitBaseUnits),
		InventoryPolicy: input.InventoryPolicy, InventoryOnHandBaseUnits: int64(input.InventoryOnHandBaseUnits),
	}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffer(w, http.StatusOK, result)
}
