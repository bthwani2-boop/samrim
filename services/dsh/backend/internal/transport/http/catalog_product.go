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
	mux.HandleFunc("GET /dsh/catalog/products", s.listProducts)
	mux.HandleFunc("POST /dsh/catalog/products", s.createProduct)
	mux.HandleFunc("POST /dsh/catalog/products/{productId}", s.updateProduct)
	mux.HandleFunc("GET /dsh/stores/{storeId}/assortment", s.listAssortment)
	mux.HandleFunc("POST /dsh/stores/{storeId}/assortment", s.createAssortment)
	mux.HandleFunc("POST /dsh/stores/{storeId}/assortment/{productId}", s.updateAssortment)
}

func (s *CatalogServer) listProducts(w http.ResponseWriter, r *http.Request) {
	query, barcode, limit, ok := productSearchValues(w, r)
	if !ok {
		return
	}
	var products []postgres.CentralProductRecord
	var err error
	if s.auth.Authorized(r) {
		actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
		if actorID == "" || len(actorID) > 128 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required for operator Product lookup")
			return
		}
		products, err = s.service.ListProductsForOperator(r.Context(), actorID, query, barcode, limit)
	} else {
		if bearerToken(r) == "" {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "a canonical Product lookup session is required")
			return
		}
		products, err = s.service.ListProductsForPartner(r.Context(), bearerToken(r), query, barcode, limit)
	}
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	views := make([]contract.CentralProduct, 0, len(products))
	for _, product := range products {
		views = append(views, toCentralProduct(product))
	}
	writeJSON(w, http.StatusOK, contract.CentralProductListResponse{Products: views})
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
	var input contract.CreateCentralProductRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.CreateCentralProduct(r.Context(), acting, postgres.CentralProductInput{CanonicalName: input.CanonicalName, Brand: optionalRequestString(input.Brand), Barcode: optionalRequestString(input.Barcode), CanonicalImageURL: optionalRequestString(input.CanonicalImageUrl), SellUnit: string(input.SellUnit)}, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, responseStatus(result.Replayed), contract.CentralProductResponse{Product: toCentralProduct(result.Product), IdempotentReplay: result.Replayed})
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
	var input contract.UpdateCentralProductRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateCentralProduct(r.Context(), acting, r.PathValue("productId"), postgres.CentralProductUpdateInput{CanonicalName: input.CanonicalName, Brand: optionalRequestString(input.Brand), Barcode: optionalRequestString(input.Barcode), CanonicalImageURL: optionalRequestString(input.CanonicalImageUrl), Active: input.Active}, expected, idempotency, correlation)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CentralProductResponse{Product: toCentralProduct(result.Product), IdempotentReplay: result.Replayed})
}

func productSearchValues(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	barcode := strings.TrimSpace(r.URL.Query().Get("barcode"))
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 50")
			return "", "", 0, false
		}
		limit = parsed
	}
	if len(query) > 160 || len(barcode) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Product lookup filters are invalid")
		return "", "", 0, false
	}
	return query, barcode, limit, true
}

func toCentralProduct(product postgres.CentralProductRecord) contract.CentralProduct {
	return contract.CentralProduct{ID: product.ID, CanonicalName: product.CanonicalName, Brand: optionalProductValue(product.Brand), Barcode: optionalProductValue(product.Barcode), CanonicalImageUrl: optionalProductValue(product.CanonicalImageURL), SellUnit: contract.SellUnit(product.SellUnit), Active: product.Active, Version: product.Version, CreatedAt: product.CreatedAt, UpdatedAt: product.UpdatedAt}
}

func optionalRequestString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func optionalProductValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func writeCatalogError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrCentralProductNotFound), errors.Is(err, postgres.ErrStoreAssortmentNotFound), errors.Is(err, postgres.ErrCentralProductStoreNotFound), errors.Is(err, postgres.ErrStoreAssortmentStoreNotFound), errors.Is(err, postgres.ErrStoreAssortmentProductNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "catalog record was not found")
	case errors.Is(err, postgres.ErrCentralProductIdempotency), errors.Is(err, postgres.ErrStoreAssortmentIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different catalog facts")
	case errors.Is(err, postgres.ErrCentralProductVersion), errors.Is(err, postgres.ErrStoreAssortmentVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "catalog version is stale")
	case errors.Is(err, postgres.ErrCentralProductDuplicateBarcode):
		writeError(w, http.StatusConflict, "DUPLICATE_BARCODE", "barcode is already assigned to another central Product")
	case errors.Is(err, postgres.ErrStoreAssortmentAlreadyExists):
		writeError(w, http.StatusConflict, "ASSORTMENT_EXISTS", "Store Assortment already exists for this Product")
	case errors.Is(err, postgres.ErrStoreAssortmentProductDisabled):
		writeError(w, http.StatusConflict, "PRODUCT_DISABLED", "a disabled central Product cannot be published")
	case errors.Is(err, postgres.ErrStoreAssortmentInvalidState):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Store Assortment publication state is invalid")
	case errors.Is(err, catalog.ErrCentralProductNameInvalid), errors.Is(err, catalog.ErrCentralProductBarcodeInvalid), errors.Is(err, catalog.ErrCentralProductImageInvalid), errors.Is(err, catalog.ErrCentralProductSellUnitInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "central Product facts are invalid")
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
