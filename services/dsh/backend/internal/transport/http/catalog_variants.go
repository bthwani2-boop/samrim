package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *CatalogServer) createVariant(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateCatalogVariantRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateCatalogVariant(r.Context(), acting, postgres.CatalogVariantInput{ID: input.ID, ProductID: r.PathValue("productId"), Title: input.Title, MeasurementKind: string(input.MeasurementKind), BaseUnit: string(input.BaseUnit), Active: input.Active, IdentifierType: input.IdentifierType, IdentifierValue: input.IdentifierValue}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogVariantResponse{Variant: toCatalogVariant(result.Variant), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) updateVariant(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.UpdateCatalogVariantRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateCatalogVariant(r.Context(), acting, r.PathValue("variantId"), postgres.CatalogVariantInput{Title: input.Title, MeasurementKind: string(input.MeasurementKind), BaseUnit: string(input.BaseUnit), Active: input.Active}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogVariantResponse{Variant: toCatalogVariant(result.Variant), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) createStoreVariant(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateCatalogVariantRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateStoreVariant(r.Context(), bearerToken(r), r.PathValue("storeId"), postgres.CatalogVariantInput{ID: input.ID, ProductID: r.PathValue("productId"), Title: input.Title, MeasurementKind: string(input.MeasurementKind), BaseUnit: string(input.BaseUnit), Active: input.Active, IdentifierType: input.IdentifierType, IdentifierValue: input.IdentifierValue}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogVariantResponse{Variant: toCatalogVariant(result.Variant), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) updateStoreVariant(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateCatalogVariantRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateStoreVariant(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("variantId"), postgres.CatalogVariantInput{Title: input.Title, MeasurementKind: string(input.MeasurementKind), BaseUnit: string(input.BaseUnit), Active: input.Active}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogVariantResponse{Variant: toCatalogVariant(result.Variant), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) createStoreScopedProduct(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input catalogProductCreateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	request := input.CreateCatalogProductRequest
	storeID := strings.TrimSpace(r.PathValue("storeId"))
	result, err := s.service.CreateStoreScopedProduct(r.Context(), bearerToken(r), storeID, postgres.CatalogProductInput{ID: "", VerticalID: request.VerticalID, Scope: "STORE_SCOPED", StoreID: storeID, CanonicalName: request.CanonicalName, Brand: optionalRequestString(request.Brand), VariantTitle: request.VariantTitle, MeasurementKind: string(request.MeasurementKind), BaseUnit: string(request.BaseUnit), CategoryIDs: request.CategoryIds, AttributeValues: catalogAttributeInputs(input.AttributeValues), VariantAttributeValues: catalogAttributeInputs(input.VariantAttributeValues), IdentifierType: request.IdentifierType, IdentifierValue: request.IdentifierValue, ImageURI: request.ImageUri}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func toCatalogVariant(item postgres.CatalogVariantRecord) contract.CatalogVariant {
	identifiers := make([]contract.CatalogIdentifier, 0, len(item.Identifiers))
	for _, identifier := range item.Identifiers {
		identifiers = append(identifiers, contract.CatalogIdentifier{Type: identifier.Type, Value: identifier.Value})
	}
	attributes := make([]contract.CatalogAttributeValue, 0, len(item.Attributes))
	for _, attribute := range item.Attributes {
		attributes = append(attributes, toCatalogAttributeValue(attribute))
	}
	return contract.CatalogVariant{ID: item.ID, ProductID: item.ProductID, Title: item.Title, MeasurementKind: contract.MeasurementKind(item.MeasurementKind), BaseUnit: contract.BaseUnit(item.BaseUnit), Active: item.Active, Version: item.Version, Identifiers: identifiers, Attributes: attributes, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
