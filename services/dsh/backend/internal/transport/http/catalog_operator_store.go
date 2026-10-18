package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/catalog"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) operatorStoreCatalogRead(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return "", "", false
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	store := strings.TrimSpace(r.PathValue("storeId"))
	if actor == "" || store == "" || len(store) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "acting operator and Store are required")
		return "", "", false
	}
	return actor, store, true
}

func (s *CatalogServer) listOperatorStoreCatalogProducts(w http.ResponseWriter, r *http.Request) {
	actor, store, ok := s.operatorStoreCatalogRead(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len([]rune(q)) > 160 || len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid product search")
		return
	}
	limit, ok := catalogLimit(w, r)
	if !ok {
		return
	}
	page, err := s.service.ListSharedProductsForOperatorStore(r.Context(), actor, store, q, limit, cursor)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	products := make([]contract.CatalogProduct, 0, len(page.Products))
	for _, item := range page.Products {
		products = append(products, toCatalogProduct(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductListResponse{Products: products, NextCursor: page.NextCursor})
}

func (s *CatalogServer) createOperatorStoreProduct(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.operatorStoreCatalogRead(w, r); !ok {
		return
	}
	actor, correlation, key, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input catalogProductCreateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	p := input.CreateCatalogProductRequest
	if p.Scope != "STORE_SCOPED" || strings.TrimSpace(p.StoreID) != "" && strings.TrimSpace(p.StoreID) != r.PathValue("storeId") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store scope mismatch")
		return
	}
	result, err := s.service.CreateStoreProductForOperator(r.Context(), actor, r.PathValue("storeId"), postgres.CatalogProductInput{CanonicalName: p.CanonicalName, Description: p.Description, Brand: optionalRequestString(p.Brand), MeasurementKind: string(p.MeasurementKind), BaseUnit: string(p.BaseUnit), VariantTitle: p.VariantTitle, IdentifierType: p.IdentifierType, IdentifierValue: p.IdentifierValue}, key, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) createOperatorStoreOffer(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.operatorStoreCatalogRead(w, r); !ok {
		return
	}
	actor, correlation, key, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateStoreOfferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateStoreOfferForOperator(r.Context(), actor, r.PathValue("storeId"), postgres.CatalogOfferInput{VariantID: input.VariantID, PriceMinor: int64(input.PriceMinor), QuantityPolicy: input.QuantityPolicy, QuantityMinBaseUnits: int64(input.QuantityMinBaseUnits), QuantityMaxBaseUnits: int64(input.QuantityMaxBaseUnits), QuantityStepBaseUnits: int64(input.QuantityStepBaseUnits), PricingBasis: input.PricingBasis, PricingUnitBaseUnits: int64(input.PricingUnitBaseUnits), InventoryPolicy: input.InventoryPolicy, InventoryOnHandBaseUnits: int64(input.InventoryOnHandBaseUnits)}, key, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffer(w, responseStatus(result.Replayed), result)
}

func (s *CatalogServer) updateOperatorStoreOffer(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.operatorStoreCatalogRead(w, r); !ok {
		return
	}
	actor, correlation, key, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	expected, parseErr := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if parseErr != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version is required")
		return
	}
	var input contract.UpdateStoreOfferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateStoreOfferForOperator(r.Context(), actor, r.PathValue("storeId"), r.PathValue("offerId"), postgres.CatalogOfferUpdateInput{PriceMinor: int64(input.PriceMinor), Availability: input.Availability, PublicationState: string(input.PublicationState), QuantityPolicy: input.QuantityPolicy, QuantityMinBaseUnits: int64(input.QuantityMinBaseUnits), QuantityMaxBaseUnits: int64(input.QuantityMaxBaseUnits), QuantityStepBaseUnits: int64(input.QuantityStepBaseUnits), PricingBasis: input.PricingBasis, PricingUnitBaseUnits: int64(input.PricingUnitBaseUnits), InventoryPolicy: input.InventoryPolicy, InventoryOnHandBaseUnits: int64(input.InventoryOnHandBaseUnits)}, expected, key, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffer(w, http.StatusOK, result)
}

func (s *CatalogServer) readOperatorStoreProduct(w http.ResponseWriter, r *http.Request) {
	actor, store, ok := s.operatorStoreCatalogRead(w, r)
	if !ok {
		return
	}
	item, err := s.service.ReadStoreProductForOperator(r.Context(), actor, store, r.PathValue("productId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toCatalogProduct(item))
}
func (s *CatalogServer) updateOperatorStoreProduct(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.operatorStoreCatalogRead(w, r); !ok {
		return
	}
	actor, correlation, key, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var request contract.UpdateCatalogProductRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	input := postgres.CatalogProductUpdateInput{CanonicalName: request.CanonicalName, Description: request.Description, Brand: optionalRequestString(request.Brand), Active: request.Active}
	result, err := s.service.UpdateStoreProductForOperator(r.Context(), actor, r.PathValue("storeId"), r.PathValue("productId"), input, expected, key, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}
func (s *CatalogServer) uploadOperatorStoreProductMedia(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := s.operatorStoreCatalogRead(w, r); !ok {
		return
	}
	actor, correlation, key, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	if s.media == nil {
		writeError(w, http.StatusServiceUnavailable, "MEDIA_STORAGE_UNAVAILABLE", "media storage is unavailable")
		return
	}
	upload, ok := parseCatalogMediaUpload(w, r)
	if !ok {
		return
	}
	result, err := s.service.UploadStoreProductMediaForOperator(r.Context(), actor, r.PathValue("storeId"), r.PathValue("productId"), catalog.CatalogMediaUploadInput{Role: upload.role, IdempotencyKey: key, CorrelationID: correlation, ExpectedVersion: expected, ContentType: upload.contentType, Provenance: upload.provenance, Bytes: upload.bytes})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}
