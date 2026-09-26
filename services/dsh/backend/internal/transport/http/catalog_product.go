package transporthttp

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/catalog"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type CatalogServer struct {
	service *catalog.Service
	auth    *auth.ServiceToken
	media   media.Store
}

func (s *CatalogServer) ReconcileMediaStorage(ctx context.Context) error {
	if s.media == nil {
		return nil
	}
	return s.service.ReconcileMediaStorage(ctx)
}

func NewCatalog(identityClient *identityintegration.Client, accessToken string, db *sql.DB) (*CatalogServer, error) {
	return NewCatalogWithMediaStore(identityClient, accessToken, db, nil)
}

func NewCatalogWithMediaStore(identityClient *identityintegration.Client, accessToken string, db *sql.DB, mediaStore media.Store) (*CatalogServer, error) {
	service, err := catalog.NewWithMediaStore(identityClient, db, mediaStore)
	if err != nil {
		return nil, err
	}
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	return &CatalogServer{service: service, auth: authorizer, media: mediaStore}, nil
}

func (s *CatalogServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/public/catalog/attributes/{attributeId}/enum-options", s.listPublicAttributeEnumOptions)
	mux.HandleFunc("GET /dsh/catalog/verticals", s.listVerticals)
	mux.HandleFunc("POST /dsh/catalog/verticals", s.createVertical)
	mux.HandleFunc("PATCH /dsh/catalog/verticals/{verticalId}", s.updateVertical)
	mux.HandleFunc("GET /dsh/catalog/categories", s.listCategories)
	mux.HandleFunc("GET /dsh/catalog/categories/{categoryId}", s.readCategory)
	mux.HandleFunc("GET /dsh/public/catalog/categories/{categoryId}/attribute-rules", s.listPublicCategoryAttributeRules)
	mux.HandleFunc("POST /dsh/catalog/categories", s.createCategory)
	mux.HandleFunc("PATCH /dsh/catalog/categories/{categoryId}", s.updateCategory)
	mux.HandleFunc("POST /dsh/catalog/categories/{categoryId}/media/upload", s.uploadCategoryMedia)
	mux.HandleFunc("GET /dsh/catalog/attributes", s.listAttributeDefinitions)
	mux.HandleFunc("POST /dsh/catalog/attributes", s.createAttributeDefinition)
	mux.HandleFunc("GET /dsh/catalog/products", s.listProducts)
	mux.HandleFunc("GET /dsh/catalog/product-registry", s.listProductRegistry)
	mux.HandleFunc("POST /dsh/catalog/products", s.createProduct)
	mux.HandleFunc("GET /dsh/catalog/products/{productId}", s.readProduct)
	mux.HandleFunc("PATCH /dsh/catalog/products/{productId}", s.updateProduct)
	mux.HandleFunc("PUT /dsh/catalog/products/{productId}/media", s.replaceProductMedia)
	mux.HandleFunc("POST /dsh/catalog/products/{productId}/media/upload", s.uploadProductMedia)
	mux.HandleFunc("PUT /dsh/stores/{storeId}/products/{productId}/media", s.replaceStoreProductMedia)
	mux.HandleFunc("POST /dsh/stores/{storeId}/products/{productId}/media/upload", s.uploadStoreProductMedia)
	mux.HandleFunc("GET /dsh/catalog/media/{key...}", s.readProductMedia)
	mux.HandleFunc("PUT /dsh/catalog/products/{productId}/attributes/{attributeId}", s.upsertProductAttribute)
	mux.HandleFunc("POST /dsh/catalog/products/{productId}/variants", s.createVariant)
	mux.HandleFunc("PATCH /dsh/catalog/variants/{variantId}", s.updateVariant)
	mux.HandleFunc("PUT /dsh/catalog/variants/{variantId}/attributes/{attributeId}", s.upsertVariantAttribute)
	mux.HandleFunc("PATCH /dsh/stores/{storeId}/products/{productId}", s.updateStoreScopedProduct)
	mux.HandleFunc("POST /dsh/stores/{storeId}/products/{productId}/variants", s.createStoreVariant)
	mux.HandleFunc("PATCH /dsh/stores/{storeId}/variants/{variantId}", s.updateStoreVariant)
	mux.HandleFunc("PUT /dsh/catalog/categories/{categoryId}/attribute-rules/{attributeId}", s.upsertCategoryAttributeRule)
	mux.HandleFunc("GET /dsh/catalog/categories/{categoryId}/attribute-rules", s.listCategoryAttributeRules)
	mux.HandleFunc("POST /dsh/stores/{storeId}/products", s.createStoreScopedProduct)
	mux.HandleFunc("GET /dsh/catalog/product-proposals", s.listOwnProductProposals)
	mux.HandleFunc("POST /dsh/catalog/product-proposals", s.createProductProposal)
	mux.HandleFunc("POST /dsh/catalog/product-proposals/{proposalId}/submit", s.submitProductProposal)
	mux.HandleFunc("PATCH /dsh/catalog/product-proposals/{proposalId}", s.updateProductProposal)
	mux.HandleFunc("POST /dsh/catalog/imports/preview", s.previewCatalogImport)
	mux.HandleFunc("GET /dsh/catalog/imports/{runId}", s.readCatalogImportRun)
	mux.HandleFunc("POST /dsh/catalog/imports/{runId}/commit", s.commitCatalogImport)
	mux.HandleFunc("GET /dsh/catalog/attributes/{attributeId}/enum-options", s.listAttributeEnumOptions)
	mux.HandleFunc("POST /dsh/catalog/attributes/{attributeId}/enum-options", s.createAttributeEnumOption)
	mux.HandleFunc("GET /dsh/catalog/product-proposals/review-queue", s.listProductProposalReviewQueue)
	mux.HandleFunc("POST /dsh/catalog/product-proposals/{proposalId}/review", s.reviewProductProposal)
	mux.HandleFunc("GET /dsh/stores/{storeId}/offers", s.listOffers)
	mux.HandleFunc("POST /dsh/stores/{storeId}/offers", s.createOffer)
	mux.HandleFunc("PATCH /dsh/stores/{storeId}/offers/{offerId}", s.updateOffer)
	mux.HandleFunc("POST /dsh/stores/{storeId}/modifier-groups", s.createModifierGroup)
	mux.HandleFunc("POST /dsh/stores/{storeId}/modifier-groups/{groupId}/options", s.createModifierOption)
	mux.HandleFunc("PUT /dsh/stores/{storeId}/offers/{offerId}/modifier-groups/{groupId}", s.attachModifierGroup)
	mux.HandleFunc("POST /dsh/stores/{storeId}/sections", s.createStorefrontSection)
	mux.HandleFunc("PUT /dsh/stores/{storeId}/sections/{sectionId}/offers/{offerId}", s.attachOfferToSection)
}

func (s *CatalogServer) listVerticals(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("includeInactive") != "true"
	var items []postgres.CommerceVerticalRecord
	var err error
	if activeOnly {
		items, err = s.service.ListVerticals(r.Context(), true)
	} else {
		if !s.auth.Authorized(r) {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
			return
		}
		acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if acting == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
			return
		}
		items, err = s.service.ListVerticalsForOperator(r.Context(), acting, false)
	}
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CommerceVertical, 0, len(items))
	for _, item := range items {
		values = append(values, toCommerceVertical(item))
	}
	writeJSON(w, http.StatusOK, contract.CommerceVerticalListResponse{Verticals: values})
}

func (s *CatalogServer) createVertical(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateCommerceVerticalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateVertical(r.Context(), acting, postgres.CommerceVerticalRecord{ID: input.ID, NameAr: input.NameAr, NameEn: input.NameEn, CatalogModel: string(input.CatalogModel), Active: input.Active}, idempotency, correlation, input.Reason)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CommerceVerticalResponse{Vertical: toCommerceVertical(result.Vertical), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) updateVertical(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.UpdateCommerceVerticalRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateVertical(r.Context(), acting, r.PathValue("verticalId"), postgres.UpdateCommerceVerticalInput{NameAr: input.NameAr, NameEn: input.NameEn, CatalogModel: string(input.CatalogModel), Active: input.Active, ExpectedVersion: input.ExpectedVersion}, idempotency, correlation, input.Reason)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CommerceVerticalResponse{Vertical: toCommerceVertical(result.Vertical), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) listCategories(w http.ResponseWriter, r *http.Request) {
	verticalID := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if r.URL.Query().Has("includeInactive") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "use the status filter for catalog Category state")
		return
	}
	sort := strings.TrimSpace(r.URL.Query().Get("sort"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	limit, ok := catalogLimit(w, r)
	if !ok {
		return
	}
	if len(query) > 160 || (status != "" && status != "all" && status != "active" && status != "inactive") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Category search or status filter is invalid")
		return
	}
	if len(cursor) > 2048 || (sort != "" && sort != "name_asc" && sort != "name_desc" && sort != "updated_desc") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Category cursor or sort order is invalid")
		return
	}
	if verticalID == "" || len(verticalID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "verticalId is invalid")
		return
	}
	if sort == "" {
		sort = "name_asc"
	}
	if status == "" {
		status = "active"
	}
	var page postgres.CatalogCategoryPage
	var err error
	if status == "active" {
		page, err = s.service.ListCategoryPage(r.Context(), verticalID, query, sort, limit, cursor)
	} else {
		if !s.auth.Authorized(r) {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
			return
		}
		acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if acting == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
			return
		}
		page, err = s.service.ListCategoryPageForOperator(r.Context(), acting, verticalID, query, status, sort, limit, cursor)
	}
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogCategoryListItem, 0, len(page.Categories))
	for _, item := range page.Categories {
		values = append(values, toCatalogCategoryListItem(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogCategoryListResponse{Categories: values, NextCursor: page.NextCursor})
}

func (s *CatalogServer) readCategory(w http.ResponseWriter, r *http.Request) {
	var item postgres.CatalogCategoryListItem
	var err error
	if s.auth.Authorized(r) {
		acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if acting == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
			return
		}
		item, err = s.service.ReadCategoryForOperator(r.Context(), acting, r.PathValue("categoryId"))
	} else {
		item, err = s.service.ReadCategory(r.Context(), r.PathValue("categoryId"))
	}
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogCategoryDetailResponse{Category: toCatalogCategoryListItem(item)})
}

func (s *CatalogServer) createCategory(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateCatalogCategoryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.service.CreateCategory(r.Context(), acting, postgres.CatalogCategoryRecord{ID: input.ID, VerticalID: input.VerticalID, ParentCategoryID: input.ParentCategoryID, NameAr: input.NameAr, NameEn: input.NameEn, Active: input.Active}, idempotency, correlation, input.Reason)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, contract.CatalogCategoryResponse{Category: toCatalogCategory(item)})
}

func (s *CatalogServer) updateCategory(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.UpdateCatalogCategoryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	parentID := strings.TrimSpace(input.ParentCategoryID)
	item, _, err := s.service.UpdateCategory(r.Context(), acting, r.PathValue("categoryId"), postgres.UpdateCatalogCategoryInput{ParentCategoryID: parentID, NameAr: input.NameAr, NameEn: input.NameEn, Active: input.Active, ExpectedVersion: input.ExpectedVersion}, idempotency, correlation, input.Reason)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogCategoryResponse{Category: toCatalogCategory(item)})
}

func (s *CatalogServer) uploadCategoryMedia(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
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
	reason := strings.TrimSpace(r.FormValue("reason"))
	item, err := s.service.UploadCatalogCategoryMedia(r.Context(), acting, catalog.CatalogCategoryMediaUploadInput{CategoryID: r.PathValue("categoryId"), IdempotencyKey: idempotency, CorrelationID: correlation, ExpectedVersion: expected, ContentType: upload.contentType, Bytes: upload.bytes, Reason: reason})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogCategoryResponse{Category: toCatalogCategory(item)})
}

func (s *CatalogServer) listProducts(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	verticalID := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	limit, ok := catalogLimit(w, r)
	if !ok {
		return
	}
	var page postgres.CatalogProductPage
	var err error
	if s.auth.Authorized(r) {
		actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if actorID == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
			return
		}
		page, err = s.service.ListProductsForOperator(r.Context(), actorID, query, verticalID, limit, cursor)
	} else {
		if bearerToken(r) == "" {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "a partner session is required")
			return
		}
		page, err = s.service.ListProductsForPartner(r.Context(), bearerToken(r), query, verticalID, limit, cursor)
	}
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogProduct, 0, len(page.Products))
	for _, product := range page.Products {
		values = append(values, toCatalogProduct(product))
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductListResponse{Products: values, NextCursor: page.NextCursor})
}

func (s *CatalogServer) listProductRegistry(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	verticalID := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	categoryID := strings.TrimSpace(r.URL.Query().Get("categoryId"))
	active := strings.TrimSpace(r.URL.Query().Get("active"))
	sort := strings.TrimSpace(r.URL.Query().Get("sort"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	if len(query) > 160 || len(verticalID) > 128 || len(categoryID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product registry filters are too long")
		return
	}
	limit, ok := catalogLimit(w, r)
	if !ok {
		return
	}
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	page, err := s.service.ListProductRegistryForOperator(r.Context(), actorID, query, verticalID, categoryID, active, sort, limit, cursor)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	items := make([]contract.CatalogProductRegistryItem, 0, len(page.Products))
	for _, product := range page.Products {
		brand, image := "", ""
		if product.Brand != nil {
			brand = *product.Brand
		}
		if product.PrimaryImageURI != nil {
			image = *product.PrimaryImageURI
		}
		items = append(items, contract.CatalogProductRegistryItem{ID: product.ID, VerticalID: product.VerticalID, CanonicalName: product.CanonicalName, Brand: brand, Active: product.Active, Version: product.Version, VariantCount: product.VariantCount, StoreCount: product.StoreCount, CategoryIds: product.CategoryIDs, PrimaryImageUri: image, CreatedAt: product.CreatedAt, UpdatedAt: product.UpdatedAt})
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductRegistryResponse{Products: items, NextCursor: page.NextCursor})
}

func (s *CatalogServer) readProduct(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	product, err := s.service.ReadSharedCatalogProduct(r.Context(), actorID, r.PathValue("productId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toCatalogProduct(product))
}

func (s *CatalogServer) createProduct(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input catalogProductCreateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	request := input.CreateCatalogProductRequest
	result, err := s.service.CreateCatalogProduct(r.Context(), acting, postgres.CatalogProductInput{VerticalID: request.VerticalID, Scope: request.Scope, StoreID: request.StoreID, CanonicalName: request.CanonicalName, Description: request.Description, Brand: optionalRequestString(request.Brand), MeasurementKind: string(request.MeasurementKind), BaseUnit: string(request.BaseUnit), VariantTitle: request.VariantTitle, CategoryIDs: request.CategoryIds, AttributeValues: catalogAttributeInputs(input.AttributeValues), VariantAttributeValues: catalogAttributeInputs(input.VariantAttributeValues), IdentifierType: request.IdentifierType, IdentifierValue: request.IdentifierValue}, idempotency, correlation)
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrCatalogCategoryNotFound):
			log.Print("DSH_CATALOG_PRODUCT_CREATE_NOT_FOUND category")
		case errors.Is(err, postgres.ErrCatalogVerticalNotFound):
			log.Print("DSH_CATALOG_PRODUCT_CREATE_NOT_FOUND vertical")
		case errors.Is(err, postgres.ErrCatalogProductNotFound):
			log.Print("DSH_CATALOG_PRODUCT_CREATE_NOT_FOUND product")
		}
		if errors.Is(err, postgres.ErrCatalogCategoryNotFound) {
			log.Printf("DSH_CATALOG_PRODUCT_CREATE_CATEGORY_ERROR detail=%q", err.Error())
		}
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) updateProduct(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.UpdateCatalogProductRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if (input.CategoryIds != nil) != (input.AttributeValues != nil) || (input.CategoryIds != nil) != (input.VariantAttributeValues != nil) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "categoryIds and both typed attribute arrays must be supplied together")
		return
	}
	result, err := s.service.UpdateCatalogProduct(r.Context(), acting, r.PathValue("productId"), postgres.CatalogProductUpdateInput{VerticalID: input.VerticalID, Scope: input.Scope, StoreID: input.StoreID, CanonicalName: input.CanonicalName, Description: input.Description, Brand: optionalRequestString(input.Brand), Active: input.Active, CategoryIDs: input.CategoryIds, AttributeValues: catalogAttributeInputsFromContract(input.AttributeValues), VariantAttributeValues: catalogVariantAttributeValueSets(input.VariantAttributeValues)}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) replaceProductMedia(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.ReplaceCatalogProductMediaRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	media := make([]postgres.CatalogMediaInput, 0, len(input.Media))
	for _, item := range input.Media {
		media = append(media, postgres.CatalogMediaInput{URI: item.Uri, Role: item.Role, Ordinal: item.Ordinal})
	}
	result, err := s.service.ReplaceCatalogProductMedia(r.Context(), acting, r.PathValue("productId"), media, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) uploadProductMedia(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
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
	result, err := s.service.UploadCatalogProductMedia(r.Context(), acting, catalog.CatalogMediaUploadInput{ProductID: r.PathValue("productId"), Role: upload.role, IdempotencyKey: idempotency, CorrelationID: correlation, ExpectedVersion: expected, ContentType: upload.contentType, Bytes: upload.bytes})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) uploadStoreProductMedia(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
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
	result, err := s.service.UploadStoreScopedProductMedia(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("productId"), catalog.CatalogMediaUploadInput{Role: upload.role, IdempotencyKey: idempotency, CorrelationID: correlation, ExpectedVersion: expected, ContentType: upload.contentType, Bytes: upload.bytes})
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) replaceStoreProductMedia(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.ReplaceCatalogProductMediaRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	media := make([]postgres.CatalogMediaInput, 0, len(input.Media))
	for _, item := range input.Media {
		media = append(media, postgres.CatalogMediaInput{URI: item.Uri, Role: item.Role, Ordinal: item.Ordinal})
	}
	result, err := s.service.ReplaceStoreScopedProductMedia(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("productId"), media, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

type catalogMediaUpload struct {
	role        string
	contentType string
	bytes       []byte
}

func parseCatalogMediaUpload(w http.ResponseWriter, r *http.Request) (catalogMediaUpload, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+1)
	if err := r.ParseMultipartForm(media.MaxUploadBytes + 1); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid image upload is required")
		return catalogMediaUpload{}, false
	}
	role := strings.TrimSpace(r.FormValue("role"))
	file, header, err := r.FormFile("file")
	if err != nil || header == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a file field is required")
		return catalogMediaUpload{}, false
	}
	defer file.Close()
	if header.Size < 1 || header.Size > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return catalogMediaUpload{}, false
	}
	bytes, err := io.ReadAll(io.LimitReader(file, media.MaxUploadBytes+1))
	if err != nil || int64(len(bytes)) > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return catalogMediaUpload{}, false
	}
	contentType, _, _, err := media.ValidateImageBytes(bytes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "only valid JPEG and PNG images are accepted")
		return catalogMediaUpload{}, false
	}
	return catalogMediaUpload{role: role, contentType: contentType, bytes: bytes}, true
}

func (s *CatalogServer) readProductMedia(w http.ResponseWriter, r *http.Request) {
	if s.media == nil {
		writeError(w, http.StatusServiceUnavailable, "MEDIA_STORAGE_UNAVAILABLE", "media storage is unavailable")
		return
	}
	key := strings.TrimSpace(r.PathValue("key"))
	if err := media.ValidateObjectKey(key); err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "media object was not found")
		return
	}
	object, err := s.media.Get(r.Context(), key)
	if errors.Is(err, media.ErrObjectNotFound) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "media object was not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "MEDIA_STORAGE_UNAVAILABLE", "media storage is unavailable")
		return
	}
	defer object.Close()
	w.Header().Set("Content-Type", object.Info.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(object.Info.Size, 10))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if object.Info.ETag != "" {
		w.Header().Set("ETag", object.Info.ETag)
	}
	_, _ = io.Copy(w, object)
}

func (s *CatalogServer) updateStoreScopedProduct(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateCatalogProductRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateStoreScopedProduct(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("productId"), postgres.CatalogProductUpdateInput{VerticalID: input.VerticalID, Scope: "STORE_SCOPED", StoreID: r.PathValue("storeId"), CanonicalName: input.CanonicalName, Description: input.Description, Brand: optionalRequestString(input.Brand), Active: input.Active}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductResponse{Product: toCatalogProduct(result.Product), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) listOffers(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "offer cursor is invalid")
		return
	}
	page, err := s.service.ListOffersForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), limit, cursor)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffers(w, http.StatusOK, page)
}
func (s *CatalogServer) createOffer(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredPartnerOfferHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CreateStoreOfferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateStoreOffer(r.Context(), bearerToken(r), r.PathValue("storeId"), input.VariantID, int64(input.PriceMinor), input.QuantityPolicy, int64(input.QuantityMinBaseUnits), int64(input.QuantityMaxBaseUnits), int64(input.QuantityStepBaseUnits), input.PricingBasis, int64(input.PricingUnitBaseUnits), input.InventoryPolicy, int64(input.InventoryOnHandBaseUnits), idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffer(w, responseStatus(result.Replayed), result)
}
func (s *CatalogServer) updateOffer(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredPartnerOfferHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpdateStoreOfferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateStoreOffer(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("offerId"), int64(input.PriceMinor), input.Availability, string(input.PublicationState), input.QuantityPolicy, int64(input.QuantityMinBaseUnits), int64(input.QuantityMaxBaseUnits), int64(input.QuantityStepBaseUnits), input.PricingBasis, int64(input.PricingUnitBaseUnits), input.InventoryPolicy, int64(input.InventoryOnHandBaseUnits), expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffer(w, http.StatusOK, result)
}

func catalogLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return 0, false
		}
		limit = parsed
	}
	if len(strings.TrimSpace(r.URL.Query().Get("q"))) > 160 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "q must not exceed 160 characters")
		return 0, false
	}
	return limit, true
}
func toCommerceVertical(item postgres.CommerceVerticalRecord) contract.CommerceVertical {
	model := contract.CatalogModel(item.CatalogModel)
	return contract.CommerceVertical{ID: item.ID, NameAr: item.NameAr, NameEn: item.NameEn, CatalogModel: model, Active: item.Active, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func toCatalogCategory(item postgres.CatalogCategoryRecord) contract.CatalogCategory {
	return contract.CatalogCategory{ID: item.ID, VerticalID: item.VerticalID, ParentCategoryID: item.ParentCategoryID, NameAr: item.NameAr, NameEn: item.NameEn, ImageUri: item.ImageURI, Active: item.Active, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func toCatalogCategoryListItem(item postgres.CatalogCategoryListItem) contract.CatalogCategoryListItem {
	return contract.CatalogCategoryListItem{ID: item.ID, VerticalID: item.VerticalID, ParentCategoryID: item.ParentCategoryID, NameAr: item.NameAr, NameEn: item.NameEn, ImageUri: item.ImageURI, Active: item.Active, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt, PathAr: item.PathAr, PathEn: item.PathEn}
}
func toCatalogProduct(item postgres.CatalogProductRecord) contract.CatalogProduct {
	variants := make([]contract.CatalogVariant, 0, len(item.Variants))
	for _, v := range item.Variants {
		ids := make([]contract.CatalogIdentifier, 0, len(v.Identifiers))
		for _, id := range v.Identifiers {
			ids = append(ids, contract.CatalogIdentifier{Type: id.Type, Value: id.Value})
		}
		attributes := make([]contract.CatalogAttributeValue, 0, len(v.Attributes))
		for _, attribute := range v.Attributes {
			attributes = append(attributes, toCatalogAttributeValue(attribute))
		}
		variants = append(variants, contract.CatalogVariant{ID: v.ID, ProductID: v.ProductID, Title: v.Title, MeasurementKind: contract.MeasurementKind(v.MeasurementKind), BaseUnit: contract.BaseUnit(v.BaseUnit), Active: v.Active, Version: v.Version, Identifiers: ids, Attributes: attributes, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt})
	}
	media := make([]contract.CatalogMedia, 0, len(item.Media))
	for _, m := range item.Media {
		media = append(media, contract.CatalogMedia{Uri: m.URI, Role: m.Role, Ordinal: m.Ordinal})
	}
	attributes := make([]contract.CatalogAttributeValue, 0, len(item.Attributes))
	for _, attribute := range item.Attributes {
		attributes = append(attributes, toCatalogAttributeValue(attribute))
	}
	return contract.CatalogProduct{ID: item.ID, VerticalID: item.VerticalID, Scope: item.Scope, StoreID: item.StoreID, CanonicalName: item.CanonicalName, Description: item.Description, Brand: optionalProductValue(item.Brand), Active: item.Active, Version: item.Version, Variants: variants, CategoryIds: item.CategoryIDs, Attributes: attributes, Media: media, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func toCatalogAttributeValue(item postgres.CatalogAttributeValueRecord) contract.CatalogAttributeValue {
	result := contract.CatalogAttributeValue{AttributeID: item.AttributeID, Code: item.Code, ValueKind: item.ValueKind}
	if item.TextValue != nil {
		result.TextValue = item.TextValue
	}
	if item.IntegerValue != nil {
		value := int(*item.IntegerValue)
		result.IntegerValue = &value
	}
	if item.DecimalValue != nil {
		result.DecimalValue = item.DecimalValue
	}
	if item.BooleanValue != nil {
		result.BooleanValue = item.BooleanValue
	}
	if item.EnumValue != nil {
		result.EnumValue = item.EnumValue
	}
	if item.DateValue != nil {
		result.DateValue = item.DateValue
	}
	if item.MeasurementUnit != nil {
		result.MeasurementUnit = item.MeasurementUnit
	}
	return result
}

func writeCatalogError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCatalogProductRegistryInvalidCursor):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product registry cursor, filters, status, or sort order are invalid")
	case errors.Is(err, postgres.ErrCatalogCategoryInvalidCursor):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Category cursor, filters, or sort order are invalid")
	case errors.Is(err, postgres.ErrCatalogOfferInvalidCursor):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "StoreOffer cursor or page size is invalid")
	case errors.Is(err, postgres.ErrCatalogProductNotFound), errors.Is(err, postgres.ErrCatalogVariantNotFound), errors.Is(err, postgres.ErrCatalogOfferNotFound), errors.Is(err, postgres.ErrCatalogCategoryNotFound), errors.Is(err, postgres.ErrCatalogVerticalNotFound), errors.Is(err, postgres.ErrCatalogProposalNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "catalog record was not found")
	case errors.Is(err, postgres.ErrCatalogIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different catalog facts")
	case errors.Is(err, postgres.ErrCatalogVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "catalog version is stale")
	case errors.Is(err, postgres.ErrCatalogVerticalModelLocked):
		writeError(w, http.StatusConflict, "CATALOG_MODEL_LOCKED", "catalog model cannot change after products exist")
	case errors.Is(err, postgres.ErrCatalogVerticalModelInUse):
		writeError(w, http.StatusConflict, "CATALOG_MODEL_IN_USE", "existing products or proposals must match the selected catalog model")
	case errors.Is(err, postgres.ErrCatalogVerticalModelInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a catalog model must be assigned to the commerce vertical")
	case errors.Is(err, postgres.ErrCatalogCategoryCycle):
		writeError(w, http.StatusConflict, "CATEGORY_CYCLE", "a category cannot be placed under its own descendant")
	case errors.Is(err, postgres.ErrCatalogProposalConflict):
		writeError(w, http.StatusConflict, "STATE_OR_VERSION_CONFLICT", "catalog Product proposal state or version is stale")
	case errors.Is(err, postgres.ErrCatalogDuplicateIdentifier):
		writeError(w, http.StatusConflict, "DUPLICATE_IDENTIFIER", "identifier is already assigned to another Variant")
	case errors.Is(err, postgres.ErrCatalogAttributeRuleInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog attribute rule is invalid")
	case errors.Is(err, postgres.ErrCatalogIdentifierInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog identifier facts are invalid")
	case errors.Is(err, postgres.ErrCatalogMediaInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product media facts are invalid")
	case errors.Is(err, catalog.ErrCatalogMediaUploadInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product image upload is invalid")
	case errors.Is(err, catalog.ErrCatalogMediaStorageUnavailable):
		writeError(w, http.StatusServiceUnavailable, "MEDIA_STORAGE_UNAVAILABLE", "media storage is unavailable")
	case errors.Is(err, postgres.ErrCatalogOfferAlreadyExists):
		writeError(w, http.StatusConflict, "OFFER_EXISTS", "StoreOffer already exists for this Variant")
	case errors.Is(err, postgres.ErrCatalogOfferProductDisabled):
		writeError(w, http.StatusConflict, "PRODUCT_NOT_ELIGIBLE", "Product/Variant/vertical is not eligible for this StoreOffer")
	case errors.Is(err, postgres.ErrCatalogProductModelMismatch):
		writeError(w, http.StatusConflict, "CATALOG_MODEL_MISMATCH", "product entry does not match the configured catalog for this Commerce Vertical")
	case errors.Is(err, postgres.ErrCatalogOfferQuantityInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog quantity or measurement policy is invalid")
	case errors.Is(err, postgres.ErrCatalogInventoryInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog inventory facts are invalid")
	case errors.Is(err, postgres.ErrCatalogInventoryReserved):
		writeError(w, http.StatusConflict, "INVENTORY_RESERVED", "active inventory reservations must be settled before changing inventory mode")
	case errors.Is(err, postgres.ErrCatalogProductOwnership):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "catalog Product ownership is invalid")
	case errors.Is(err, postgres.ErrCatalogProposalInvalid), errors.Is(err, postgres.ErrCatalogProposalReview):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product proposal facts or decision are invalid")
	case errors.Is(err, postgres.ErrCatalogImportInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog import facts are invalid")
	case errors.Is(err, postgres.ErrCatalogOfferInvalidState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "StoreOffer publication state is invalid")
	case errors.Is(err, catalog.ErrCatalogVerticalInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "commerce vertical facts are invalid")
	case errors.Is(err, catalog.ErrCatalogCategoryInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog category facts are invalid")
	case errors.Is(err, catalog.ErrCatalogProductNameInvalid), errors.Is(err, catalog.ErrCatalogProductIdentifierInvalid), errors.Is(err, catalog.ErrCatalogProductImageInvalid), errors.Is(err, catalog.ErrCatalogProductScopeInvalid), errors.Is(err, catalog.ErrCatalogProductVerticalInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product facts are invalid")
	case errors.Is(err, catalog.ErrCatalogModifierInvalid), errors.Is(err, catalog.ErrCatalogSectionInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog extension facts are invalid")
	case errors.Is(err, catalog.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
	case errors.Is(err, catalog.ErrOperatorPermission):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Catalog permission is required")
	case errors.Is(err, catalog.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	case errors.Is(err, catalog.ErrStoreOwnershipForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "partner Store ownership is required")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
