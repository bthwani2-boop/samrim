package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/catalog"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type CatalogServer struct {
	service *catalog.Service
	auth    *auth.ServiceToken
}

func NewCatalog(identityClient *identityintegration.Client, accessToken string, db *sql.DB) (*CatalogServer, error) {
	service, err := catalog.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	return &CatalogServer{service: service, auth: authorizer}, nil
}

func (s *CatalogServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/catalog/verticals", s.listVerticals)
	mux.HandleFunc("POST /dsh/catalog/verticals", s.createVertical)
	mux.HandleFunc("GET /dsh/catalog/categories", s.listCategories)
	mux.HandleFunc("POST /dsh/catalog/categories", s.createCategory)
	mux.HandleFunc("GET /dsh/catalog/products", s.listProducts)
	mux.HandleFunc("POST /dsh/catalog/products", s.createProduct)
	mux.HandleFunc("PATCH /dsh/catalog/products/{productId}", s.updateProduct)
	mux.HandleFunc("GET /dsh/stores/{storeId}/offers", s.listOffers)
	mux.HandleFunc("POST /dsh/stores/{storeId}/offers", s.createOffer)
	mux.HandleFunc("PATCH /dsh/stores/{storeId}/offers/{offerId}", s.updateOffer)
}

func (s *CatalogServer) listVerticals(w http.ResponseWriter, r *http.Request) {
	items, err := s.service.ListVerticals(r.Context(), true)
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
	result, err := s.service.CreateVertical(r.Context(), acting, postgres.CommerceVerticalRecord{ID: input.ID, NameAr: input.NameAr, NameEn: input.NameEn, Active: input.Active}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CommerceVerticalResponse{Vertical: toCommerceVertical(result.Vertical), IdempotentReplay: result.Replayed})
}

func (s *CatalogServer) listCategories(w http.ResponseWriter, r *http.Request) {
	verticalID := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	if verticalID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "verticalId is required")
		return
	}
	items, err := s.service.ListCategories(r.Context(), verticalID, true)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogCategory, 0, len(items))
	for _, item := range items {
		values = append(values, toCatalogCategory(item))
	}
	writeJSON(w, http.StatusOK, contract.CatalogCategoryListResponse{Categories: values})
}

func (s *CatalogServer) createCategory(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, _, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateCatalogCategoryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.service.CreateCategory(r.Context(), acting, postgres.CatalogCategoryRecord{ID: input.ID, VerticalID: input.VerticalID, ParentCategoryID: input.ParentCategoryID, NameAr: input.NameAr, NameEn: input.NameEn, Active: input.Active}, idempotency)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, contract.CatalogCategoryResponse{Category: toCatalogCategory(item)})
}

func (s *CatalogServer) listProducts(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	verticalID := strings.TrimSpace(r.URL.Query().Get("verticalId"))
	limit, ok := catalogLimit(w, r)
	if !ok {
		return
	}
	var products []postgres.CatalogProductRecord
	var err error
	if s.auth.Authorized(r) {
		actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if actorID == "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
			return
		}
		products, err = s.service.ListProductsForOperator(r.Context(), actorID, query, verticalID, limit)
	} else {
		if bearerToken(r) == "" {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "a partner session is required")
			return
		}
		products, err = s.service.ListProductsForPartner(r.Context(), bearerToken(r), query, verticalID, limit)
	}
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	values := make([]contract.CatalogProduct, 0, len(products))
	for _, product := range products {
		values = append(values, toCatalogProduct(product))
	}
	writeJSON(w, http.StatusOK, contract.CatalogProductListResponse{Products: values})
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
	var input contract.CreateCatalogProductRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateCatalogProduct(r.Context(), acting, postgres.CatalogProductInput{VerticalID: input.VerticalID, Scope: input.Scope, CanonicalName: input.CanonicalName, Brand: optionalRequestString(input.Brand), SellUnit: string(input.SellUnit), VariantTitle: input.VariantTitle, CategoryIDs: input.CategoryIds, IdentifierType: input.IdentifierType, IdentifierValue: input.IdentifierValue, ImageURI: input.ImageUri}, idempotency, correlation)
	if err != nil {
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
	result, err := s.service.UpdateCatalogProduct(r.Context(), acting, r.PathValue("productId"), postgres.CatalogProductUpdateInput{VerticalID: input.VerticalID, Scope: input.Scope, CanonicalName: input.CanonicalName, Brand: optionalRequestString(input.Brand), Active: input.Active}, expected, idempotency, correlation)
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
	items, err := s.service.ListOffersForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"))
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeOffers(w, http.StatusOK, items)
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
	result, err := s.service.CreateStoreOffer(r.Context(), bearerToken(r), r.PathValue("storeId"), input.VariantID, int64(input.PriceMinor), input.QuantityPolicy, input.PricingBasis, idempotency, correlation)
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
	result, err := s.service.UpdateStoreOffer(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("offerId"), int64(input.PriceMinor), input.Availability, string(input.PublicationState), expected, idempotency, correlation)
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
	return contract.CommerceVertical{ID: item.ID, NameAr: item.NameAr, NameEn: item.NameEn, Active: item.Active, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func toCatalogCategory(item postgres.CatalogCategoryRecord) contract.CatalogCategory {
	return contract.CatalogCategory{ID: item.ID, VerticalID: item.VerticalID, ParentCategoryID: item.ParentCategoryID, NameAr: item.NameAr, NameEn: item.NameEn, Active: item.Active, Version: item.Version, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func toCatalogProduct(item postgres.CatalogProductRecord) contract.CatalogProduct {
	variants := make([]contract.CatalogVariant, 0, len(item.Variants))
	for _, v := range item.Variants {
		ids := make([]contract.CatalogIdentifier, 0, len(v.Identifiers))
		for _, id := range v.Identifiers {
			ids = append(ids, contract.CatalogIdentifier{Type: id.Type, Value: id.Value})
		}
		variants = append(variants, contract.CatalogVariant{ID: v.ID, ProductID: v.ProductID, Title: v.Title, SellUnit: contract.SellUnit(v.SellUnit), Active: v.Active, Version: v.Version, Identifiers: ids, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt})
	}
	media := make([]contract.CatalogMedia, 0, len(item.Media))
	for _, m := range item.Media {
		media = append(media, contract.CatalogMedia{Uri: m.URI, Role: m.Role, Ordinal: m.Ordinal})
	}
	return contract.CatalogProduct{ID: item.ID, VerticalID: item.VerticalID, Scope: item.Scope, CanonicalName: item.CanonicalName, Brand: optionalProductValue(item.Brand), Active: item.Active, Version: item.Version, Variants: variants, CategoryIds: item.CategoryIDs, Media: media, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func writeCatalogError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCatalogProductNotFound), errors.Is(err, postgres.ErrCatalogVariantNotFound), errors.Is(err, postgres.ErrCatalogOfferNotFound), errors.Is(err, postgres.ErrCatalogCategoryNotFound), errors.Is(err, postgres.ErrCatalogVerticalNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "catalog record was not found")
	case errors.Is(err, postgres.ErrCatalogIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different catalog facts")
	case errors.Is(err, postgres.ErrCatalogVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "catalog version is stale")
	case errors.Is(err, postgres.ErrCatalogDuplicateIdentifier):
		writeError(w, http.StatusConflict, "DUPLICATE_IDENTIFIER", "identifier is already assigned to another Variant")
	case errors.Is(err, postgres.ErrCatalogIdentifierInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog identifier facts are invalid")
	case errors.Is(err, postgres.ErrCatalogOfferAlreadyExists):
		writeError(w, http.StatusConflict, "OFFER_EXISTS", "StoreOffer already exists for this Variant")
	case errors.Is(err, postgres.ErrCatalogOfferProductDisabled):
		writeError(w, http.StatusConflict, "PRODUCT_NOT_ELIGIBLE", "Product/Variant/vertical is not eligible for this StoreOffer")
	case errors.Is(err, postgres.ErrCatalogOfferInvalidState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "StoreOffer publication state is invalid")
	case errors.Is(err, catalog.ErrCatalogProductNameInvalid), errors.Is(err, catalog.ErrCatalogProductIdentifierInvalid), errors.Is(err, catalog.ErrCatalogProductImageInvalid), errors.Is(err, catalog.ErrCatalogProductSellUnitInvalid), errors.Is(err, catalog.ErrCatalogProductScopeInvalid), errors.Is(err, catalog.ErrCatalogProductVerticalInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog Product facts are invalid")
	case errors.Is(err, catalog.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
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
