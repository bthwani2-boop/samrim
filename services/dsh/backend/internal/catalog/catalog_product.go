package catalog

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrOperatorNotActive               = errors.New("operator actor is not active")
	ErrOperatorPermission              = errors.New("catalog permission is required")
	ErrPartnerSessionForbidden         = errors.New("an active app-partner session is required")
	ErrStoreOwnershipForbidden         = errors.New("partner does not own this store")
	ErrCatalogProductNameInvalid       = errors.New("catalog Product name is invalid")
	ErrCatalogProductIdentifierInvalid = errors.New("catalog Product identifier is invalid")
	ErrCatalogProductImageInvalid      = errors.New("catalog Product image URL is invalid")
	ErrCatalogMediaUploadInvalid       = errors.New("catalog Product media upload is invalid")
	ErrCatalogMediaStorageUnavailable  = errors.New("catalog Product media storage is unavailable")
	ErrCatalogProductScopeInvalid      = errors.New("catalog Product scope is invalid")
	ErrCatalogProductVerticalInvalid   = errors.New("catalog Product vertical is invalid")
	ErrCatalogVerticalInvalid          = errors.New("commerce vertical facts are invalid")
	ErrCatalogCategoryInvalid          = errors.New("catalog category facts are invalid")
	ErrCatalogModifierInvalid          = errors.New("catalog modifier facts are invalid")
	ErrCatalogSectionInvalid           = errors.New("catalog storefront section facts are invalid")
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
var verticalIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,127}$`)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	media    media.Store
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	return NewWithMediaStore(identity, db, nil)
}

func NewWithMediaStore(identity *identityintegration.Client, db *sql.DB, mediaStore media.Store) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("catalog configuration is invalid")
	}
	return &Service{identity: identity, db: db, media: mediaStore}, nil
}

func (s *Service) ListProductsForPartner(ctx context.Context, accessToken, query, verticalID string, limit int, cursor string) (postgres.CatalogProductPage, error) {
	identity, err := s.requirePartnerIdentity(ctx, accessToken)
	if err != nil {
		return postgres.CatalogProductPage{}, err
	}
	return postgres.ListCatalogProductsForPartner(ctx, s.db, normalizeSearch(query), strings.TrimSpace(verticalID), identity.Subject, limit, strings.TrimSpace(cursor))
}

func (s *Service) ListProductsForOperator(ctx context.Context, actingActorID, query, verticalID string, limit int, cursor string) (postgres.CatalogProductPage, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogProductPage{}, err
	}
	return postgres.ListCatalogProducts(ctx, s.db, normalizeSearch(query), strings.TrimSpace(verticalID), false, limit, strings.TrimSpace(cursor))
}

func (s *Service) ListProductRegistryForOperator(ctx context.Context, actingActorID, query, verticalID, categoryID, active, sort string, limit int, cursor string) (postgres.CatalogProductRegistryPage, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogProductRegistryPage{}, err
	}
	return postgres.ListCatalogProductRegistry(ctx, s.db, normalizeSearch(query), strings.TrimSpace(verticalID), strings.TrimSpace(categoryID), strings.TrimSpace(active), strings.TrimSpace(sort), limit, strings.TrimSpace(cursor))
}

func (s *Service) requireSharedProduct(ctx context.Context, productID string) error {
	product, err := postgres.ReadCatalogProduct(ctx, s.db, strings.TrimSpace(productID))
	if err != nil {
		return err
	}
	if product.Scope != "SHARED" || product.StoreID != "" {
		return postgres.ErrCatalogProductOwnership
	}
	vertical, err := postgres.ReadCommerceVertical(ctx, s.db, product.VerticalID)
	if err != nil {
		return err
	}
	if vertical.CatalogModel != "SHARED_CATALOG" {
		return postgres.ErrCatalogProductModelMismatch
	}
	return nil
}

func (s *Service) requireSharedVariant(ctx context.Context, variantID string) error {
	variant, err := postgres.ReadCatalogVariant(ctx, s.db, strings.TrimSpace(variantID))
	if err != nil {
		return err
	}
	return s.requireSharedProduct(ctx, variant.ProductID)
}

func (s *Service) ListVerticals(ctx context.Context, activeOnly bool) ([]postgres.CommerceVerticalRecord, error) {
	return postgres.ListCommerceVerticals(ctx, s.db, activeOnly)
}

func (s *Service) ListVerticalsForOperator(ctx context.Context, actingActorID string, activeOnly bool) ([]postgres.CommerceVerticalRecord, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return s.ListVerticals(ctx, activeOnly)
}

func (s *Service) CreateVertical(ctx context.Context, actingActorID string, item postgres.CommerceVerticalRecord, idempotencyKey, correlationID, reason string) (postgres.CommerceVerticalResult, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.CommerceVerticalResult{}, err
	}
	item.ID = strings.ToLower(strings.TrimSpace(item.ID))
	item.NameAr = strings.Join(strings.Fields(strings.TrimSpace(item.NameAr)), " ")
	item.NameEn = strings.Join(strings.Fields(strings.TrimSpace(item.NameEn)), " ")
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	if (item.ID != "" && !verticalIDPattern.MatchString(item.ID)) || !validRegistryName(item.NameAr) || !validRegistryName(item.NameEn) || (item.CatalogModel != "SHARED_CATALOG" && item.CatalogModel != "STORE_LOCAL_CATALOG") || len(reason) < 5 || len(reason) > 500 || strings.TrimSpace(correlationID) == "" {
		return postgres.CommerceVerticalResult{}, ErrCatalogVerticalInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), Reason: reason}
	return postgres.CreateCommerceVertical(ctx, s.db, item, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVerticalCreateRequest(item, reason), audit)
}

func (s *Service) UpdateVertical(ctx context.Context, actingActorID, verticalID string, input postgres.UpdateCommerceVerticalInput, idempotencyKey, correlationID, reason string) (postgres.CommerceVerticalResult, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.CommerceVerticalResult{}, err
	}
	verticalID = strings.ToLower(strings.TrimSpace(verticalID))
	input.NameAr = strings.Join(strings.Fields(strings.TrimSpace(input.NameAr)), " ")
	input.NameEn = strings.Join(strings.Fields(strings.TrimSpace(input.NameEn)), " ")
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	if !verticalIDPattern.MatchString(verticalID) || !validRegistryName(input.NameAr) || !validRegistryName(input.NameEn) || (input.CatalogModel != "SHARED_CATALOG" && input.CatalogModel != "STORE_LOCAL_CATALOG") || input.ExpectedVersion < 1 || len(reason) < 5 || len(reason) > 500 || strings.TrimSpace(correlationID) == "" {
		return postgres.CommerceVerticalResult{}, ErrCatalogVerticalInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), Reason: reason}
	return postgres.UpdateCommerceVertical(ctx, s.db, verticalID, input, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVerticalUpdateRequest(verticalID, input, reason), audit)
}

func (s *Service) ListCategories(ctx context.Context, verticalID string, activeOnly bool) ([]postgres.CatalogCategoryRecord, error) {
	if strings.TrimSpace(verticalID) == "" {
		return nil, postgres.ErrCatalogVerticalNotFound
	}
	return postgres.ListCatalogCategories(ctx, s.db, strings.TrimSpace(verticalID), activeOnly)
}

func (s *Service) ListCategoriesForOperator(ctx context.Context, actingActorID, verticalID string, activeOnly bool) ([]postgres.CatalogCategoryRecord, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return s.ListCategories(ctx, verticalID, activeOnly)
}

func (s *Service) CreateCategory(ctx context.Context, actingActorID string, item postgres.CatalogCategoryRecord, idempotencyKey, correlationID, reason string) (postgres.CatalogCategoryRecord, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogCategoryRecord{}, err
	}
	item.ID = strings.ToLower(strings.TrimSpace(item.ID))
	item.VerticalID = strings.TrimSpace(item.VerticalID)
	item.ParentCategoryID = strings.TrimSpace(item.ParentCategoryID)
	item.NameAr = strings.Join(strings.Fields(strings.TrimSpace(item.NameAr)), " ")
	item.NameEn = strings.Join(strings.Fields(strings.TrimSpace(item.NameEn)), " ")
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	if (item.ID != "" && !verticalIDPattern.MatchString(item.ID)) || !verticalIDPattern.MatchString(item.VerticalID) || (item.ParentCategoryID != "" && !verticalIDPattern.MatchString(item.ParentCategoryID)) || !validRegistryName(item.NameAr) || !validRegistryName(item.NameEn) || len(reason) < 5 || len(reason) > 500 || strings.TrimSpace(correlationID) == "" {
		return postgres.CatalogCategoryRecord{}, ErrCatalogCategoryInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), Reason: reason}
	return postgres.CreateCatalogCategory(ctx, s.db, item, strings.TrimSpace(idempotencyKey), postgres.HashCatalogCategoryCreateRequest(item, reason), audit)
}

func (s *Service) UpdateCategory(ctx context.Context, actingActorID, categoryID string, input postgres.UpdateCatalogCategoryInput, idempotencyKey, correlationID, reason string) (postgres.CatalogCategoryRecord, bool, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogCategoryRecord{}, false, err
	}
	categoryID = strings.ToLower(strings.TrimSpace(categoryID))
	input.ParentCategoryID = strings.ToLower(strings.TrimSpace(input.ParentCategoryID))
	input.NameAr = strings.Join(strings.Fields(strings.TrimSpace(input.NameAr)), " ")
	input.NameEn = strings.Join(strings.Fields(strings.TrimSpace(input.NameEn)), " ")
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	if !verticalIDPattern.MatchString(categoryID) || (input.ParentCategoryID != "" && !verticalIDPattern.MatchString(input.ParentCategoryID)) || !validRegistryName(input.NameAr) || !validRegistryName(input.NameEn) || input.ExpectedVersion < 1 || len(reason) < 5 || len(reason) > 500 || strings.TrimSpace(correlationID) == "" {
		return postgres.CatalogCategoryRecord{}, false, ErrCatalogCategoryInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), Reason: reason}
	return postgres.UpdateCatalogCategory(ctx, s.db, categoryID, input, strings.TrimSpace(idempotencyKey), postgres.HashCatalogCategoryUpdateRequest(categoryID, input, reason), audit)
}

func (s *Service) CreateCatalogProduct(ctx context.Context, actingActorID string, input postgres.CatalogProductInput, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if strings.ToUpper(strings.TrimSpace(input.Scope)) != "SHARED" || strings.TrimSpace(input.StoreID) != "" {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogProductOwnership
	}
	normalized, err := normalizeCatalogProductInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	return postgres.CreateCatalogProduct(ctx, s.db, normalized, strings.TrimSpace(idempotencyKey), postgres.HashCatalogProductCreateRequest(normalized), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) CreateStoreScopedProduct(ctx context.Context, accessToken, storeID string, input postgres.CatalogProductInput, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	input.Scope = "STORE_SCOPED"
	input.StoreID = strings.TrimSpace(storeID)
	normalized, err := normalizeCatalogProductInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	return postgres.CreateCatalogProduct(ctx, s.db, normalized, strings.TrimSpace(idempotencyKey), postgres.HashCatalogProductCreateRequest(normalized), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) CreateCatalogVariant(ctx context.Context, actingActorID string, input postgres.CatalogVariantInput, idempotencyKey, correlationID string) (postgres.CatalogVariantResult, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	if strings.TrimSpace(input.ID) == "" {
		return postgres.CatalogVariantResult{}, postgres.ErrCatalogIdentifierInvalid
	}
	if err := s.requireSharedProduct(ctx, input.ProductID); err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	return postgres.CreateCatalogVariant(ctx, s.db, input, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVariantCreateRequest(input), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) CreateStoreVariant(ctx context.Context, accessToken, storeID string, input postgres.CatalogVariantInput, idempotencyKey, correlationID string) (postgres.CatalogVariantResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	product, err := postgres.ReadCatalogProduct(ctx, s.db, input.ProductID)
	if err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	if product.Scope != "STORE_SCOPED" || product.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogVariantResult{}, postgres.ErrCatalogProductOwnership
	}
	return postgres.CreateCatalogVariant(ctx, s.db, input, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVariantCreateRequest(input), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateStoreScopedProduct(ctx context.Context, accessToken, storeID, productID string, input postgres.CatalogProductUpdateInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	current, err := postgres.ReadCatalogProduct(ctx, s.db, productID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if current.Scope != "STORE_SCOPED" || current.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogProductOwnership
	}
	normalized, err := normalizeCatalogProductUpdateInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	normalized.Scope = "STORE_SCOPED"
	normalized.StoreID = strings.TrimSpace(storeID)
	normalized.VerticalID = current.VerticalID
	return postgres.UpdateCatalogProduct(ctx, s.db, strings.TrimSpace(productID), normalized, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogProductUpdateRequest(productID, normalized, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateCatalogVariant(ctx context.Context, actingActorID, variantID string, input postgres.CatalogVariantInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogVariantResult, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	if err := s.requireSharedVariant(ctx, variantID); err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	return postgres.UpdateCatalogVariant(ctx, s.db, strings.TrimSpace(variantID), input, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVariantUpdateRequest(variantID, input, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) UpdateStoreVariant(ctx context.Context, accessToken, storeID, variantID string, input postgres.CatalogVariantInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogVariantResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	variant, err := postgres.ReadCatalogVariant(ctx, s.db, variantID)
	if err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	product, err := postgres.ReadCatalogProduct(ctx, s.db, variant.ProductID)
	if err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	if product.Scope != "STORE_SCOPED" || product.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogVariantResult{}, postgres.ErrCatalogProductOwnership
	}
	input.ProductID = variant.ProductID
	return postgres.UpdateCatalogVariant(ctx, s.db, strings.TrimSpace(variantID), input, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVariantUpdateRequest(variantID, input, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateCatalogProduct(ctx context.Context, actingActorID, productID string, input postgres.CatalogProductUpdateInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if err := s.requireSharedProduct(ctx, productID); err != nil {
		return postgres.CatalogProductResult{}, err
	}
	normalized, err := normalizeCatalogProductUpdateInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if strings.TrimSpace(productID) == "" || expectedVersion < 1 {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogVersionConflict
	}
	return postgres.UpdateCatalogProduct(ctx, s.db, strings.TrimSpace(productID), normalized, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogProductUpdateRequest(productID, normalized, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
}

func (s *Service) ReplaceCatalogProductMedia(ctx context.Context, actingActorID, productID string, media []postgres.CatalogMediaInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if err := s.requireSharedProduct(ctx, productID); err != nil {
		return postgres.CatalogProductResult{}, err
	}
	normalized, err := normalizeCatalogMedia(media)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	productID = strings.TrimSpace(productID)
	if productID == "" || expectedVersion < 1 {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogVersionConflict
	}
	result, err := postgres.ReplaceCatalogProductMedia(ctx, s.db, productID, normalized, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogMediaReplaceRequest(productID, normalized, expectedVersion), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID))
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if s.media != nil {
		_ = s.ReconcileMediaStorage(ctx)
	}
	return result, nil
}

func (s *Service) ReplaceStoreScopedProductMedia(ctx context.Context, accessToken, storeID, productID string, media []postgres.CatalogMediaInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	productID = strings.TrimSpace(productID)
	storeID = strings.TrimSpace(storeID)
	current, err := postgres.ReadCatalogProduct(ctx, s.db, productID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if current.Scope != "STORE_SCOPED" || current.StoreID != storeID {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogProductOwnership
	}
	normalized, err := normalizeCatalogMedia(media)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if expectedVersion < 1 {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogVersionConflict
	}
	result, err := postgres.ReplaceCatalogProductMedia(ctx, s.db, productID, normalized, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogMediaReplaceRequest(productID, normalized, expectedVersion), actorID, strings.TrimSpace(correlationID))
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if s.media != nil {
		_ = s.ReconcileMediaStorage(ctx)
	}
	return result, nil
}

func (s *Service) ReadCatalogProduct(ctx context.Context, actingActorID, productID string) (postgres.CatalogProductRecord, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogProductRecord{}, err
	}
	return postgres.ReadCatalogProduct(ctx, s.db, strings.TrimSpace(productID))
}

func (s *Service) ReadSharedCatalogProduct(ctx context.Context, actingActorID, productID string) (postgres.CatalogProductRecord, error) {
	product, err := s.ReadCatalogProduct(ctx, actingActorID, productID)
	if err != nil {
		return postgres.CatalogProductRecord{}, err
	}
	if product.Scope != "SHARED" || product.StoreID != "" {
		return postgres.CatalogProductRecord{}, postgres.ErrCatalogProductOwnership
	}
	vertical, err := postgres.ReadCommerceVertical(ctx, s.db, product.VerticalID)
	if err != nil {
		return postgres.CatalogProductRecord{}, err
	}
	if vertical.CatalogModel != "SHARED_CATALOG" {
		return postgres.CatalogProductRecord{}, postgres.ErrCatalogProductModelMismatch
	}
	return product, nil
}

func (s *Service) ReadCatalogVariant(ctx context.Context, actingActorID, variantID string) (postgres.CatalogVariantRecord, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "catalog"); err != nil {
		return postgres.CatalogVariantRecord{}, err
	}
	return postgres.ReadCatalogVariant(ctx, s.db, strings.TrimSpace(variantID))
}

func (s *Service) ReadAttributeRules(ctx context.Context, actingActorID, categoryID string) ([]postgres.CatalogAttributeRuleRecord, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return postgres.ReadCatalogAttributeRules(ctx, s.db, strings.TrimSpace(categoryID))
}

func (s *Service) ReadPublicAttributeRules(ctx context.Context, categoryID string) ([]postgres.CatalogAttributeRuleRecord, error) {
	return postgres.ReadPublicCatalogAttributeRules(ctx, s.db, strings.TrimSpace(categoryID))
}

func normalizeCatalogProductInput(input postgres.CatalogProductInput) (postgres.CatalogProductInput, error) {
	name, err := normalizeProductName(input.CanonicalName)
	if err != nil {
		return postgres.CatalogProductInput{}, err
	}
	brand, err := normalizeOptionalText(input.Brand, 160)
	if err != nil {
		return postgres.CatalogProductInput{}, err
	}
	description := strings.TrimSpace(input.Description)
	if utf8.RuneCountInString(description) > 4000 {
		return postgres.CatalogProductInput{}, ErrCatalogProductNameInvalid
	}
	verticalID := strings.TrimSpace(input.VerticalID)
	if verticalID == "" {
		return postgres.CatalogProductInput{}, ErrCatalogProductVerticalInvalid
	}
	scope := strings.ToUpper(strings.TrimSpace(input.Scope))
	if scope != "SHARED" && scope != "STORE_SCOPED" {
		return postgres.CatalogProductInput{}, ErrCatalogProductScopeInvalid
	}
	measurementKind := strings.ToUpper(strings.TrimSpace(input.MeasurementKind))
	baseUnit := strings.ToUpper(strings.TrimSpace(input.BaseUnit))
	if measurementKind != "DISCRETE" && measurementKind != "MEASURED" && measurementKind != "VARIABLE_MEASURE" {
		return postgres.CatalogProductInput{}, ErrCatalogProductScopeInvalid
	}
	if (measurementKind == "DISCRETE" && baseUnit != "COUNT") || (measurementKind != "DISCRETE" && baseUnit != "GRAM" && baseUnit != "MILLILITER") {
		return postgres.CatalogProductInput{}, ErrCatalogProductScopeInvalid
	}
	variantTitle := strings.Join(strings.Fields(strings.TrimSpace(input.VariantTitle)), " ")
	if variantTitle == "" {
		variantTitle = "الافتراضي"
	}
	if utf8.RuneCountInString(variantTitle) > 160 {
		return postgres.CatalogProductInput{}, ErrCatalogProductNameInvalid
	}
	identifierType := strings.ToUpper(strings.TrimSpace(input.IdentifierType))
	identifierValue := strings.TrimSpace(input.IdentifierValue)
	if identifierValue != "" && (identifierType != "GTIN" && identifierType != "EAN" && identifierType != "UPC" && identifierType != "SKU" || !identifierPattern.MatchString(identifierValue)) {
		return postgres.CatalogProductInput{}, ErrCatalogProductIdentifierInvalid
	}
	image := strings.TrimSpace(input.ImageURI)
	if image != "" {
		parsed, parseErr := url.ParseRequestURI(image)
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
			return postgres.CatalogProductInput{}, ErrCatalogProductImageInvalid
		}
	}
	categories := make([]string, 0, len(input.CategoryIDs))
	seen := map[string]bool{}
	for _, categoryID := range input.CategoryIDs {
		normalizedID := strings.TrimSpace(categoryID)
		if normalizedID == "" || seen[normalizedID] {
			continue
		}
		seen[normalizedID] = true
		categories = append(categories, normalizedID)
	}
	attributeValues := normalizeCatalogAttributeValues(input.AttributeValues)
	variantAttributeValues := normalizeCatalogAttributeValues(input.VariantAttributeValues)
	return postgres.CatalogProductInput{ID: strings.TrimSpace(input.ID), VerticalID: verticalID, Scope: scope, StoreID: strings.TrimSpace(input.StoreID), CanonicalName: name, Description: description, Brand: brand, VariantTitle: variantTitle, MeasurementKind: measurementKind, BaseUnit: baseUnit, CategoryIDs: categories, AttributeValues: attributeValues, VariantAttributeValues: variantAttributeValues, IdentifierType: identifierType, IdentifierValue: identifierValue, ImageURI: image}, nil
}

func normalizeCatalogAttributeValues(values []postgres.CatalogAttributeValueInput) []postgres.CatalogAttributeValueInput {
	normalized := append([]postgres.CatalogAttributeValueInput(nil), values...)
	for index := range normalized {
		value := &normalized[index]
		value.AttributeID = strings.TrimSpace(value.AttributeID)
		value.ValueKind = strings.ToUpper(strings.TrimSpace(value.ValueKind))
	}
	sort.Slice(normalized, func(left, right int) bool { return normalized[left].AttributeID < normalized[right].AttributeID })
	return normalized
}

func normalizeCatalogProductUpdateInput(input postgres.CatalogProductUpdateInput) (postgres.CatalogProductUpdateInput, error) {
	name, err := normalizeProductName(input.CanonicalName)
	if err != nil {
		return postgres.CatalogProductUpdateInput{}, err
	}
	brand, err := normalizeOptionalText(input.Brand, 160)
	if err != nil {
		return postgres.CatalogProductUpdateInput{}, err
	}
	description := strings.TrimSpace(input.Description)
	if utf8.RuneCountInString(description) > 4000 {
		return postgres.CatalogProductUpdateInput{}, ErrCatalogProductNameInvalid
	}
	verticalID := strings.TrimSpace(input.VerticalID)
	scope := strings.ToUpper(strings.TrimSpace(input.Scope))
	if verticalID == "" || (scope != "SHARED" && scope != "STORE_SCOPED") {
		return postgres.CatalogProductUpdateInput{}, ErrCatalogProductScopeInvalid
	}
	return postgres.CatalogProductUpdateInput{VerticalID: verticalID, Scope: scope, StoreID: strings.TrimSpace(input.StoreID), CanonicalName: name, Description: description, Brand: brand, Active: input.Active}, nil
}

func normalizeCatalogMedia(input []postgres.CatalogMediaInput) ([]postgres.CatalogMediaInput, error) {
	if len(input) > 21 {
		return nil, ErrCatalogProductImageInvalid
	}
	normalized := make([]postgres.CatalogMediaInput, 0, len(input))
	ordinals := make(map[int]struct{}, len(input))
	uris := make(map[string]struct{}, len(input))
	primaryCount := 0
	for _, item := range input {
		uri := strings.TrimSpace(item.URI)
		role := strings.ToLower(strings.TrimSpace(item.Role))
		if (role != "primary" && role != "gallery") || item.Ordinal < 0 || item.Ordinal > 20 || uri == "" || len(uri) > 2048 {
			return nil, ErrCatalogProductImageInvalid
		}
		parsed, parseErr := url.ParseRequestURI(uri)
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
			return nil, ErrCatalogProductImageInvalid
		}
		if _, exists := ordinals[item.Ordinal]; exists {
			return nil, ErrCatalogProductImageInvalid
		}
		if _, exists := uris[uri]; exists {
			return nil, ErrCatalogProductImageInvalid
		}
		ordinals[item.Ordinal] = struct{}{}
		uris[uri] = struct{}{}
		if role == "primary" {
			primaryCount++
			if item.Ordinal != 0 {
				return nil, ErrCatalogProductImageInvalid
			}
		} else if item.Ordinal == 0 {
			return nil, ErrCatalogProductImageInvalid
		}
		normalized = append(normalized, postgres.CatalogMediaInput{URI: uri, Role: role, Ordinal: item.Ordinal})
	}
	if len(normalized) > 0 && primaryCount != 1 {
		return nil, ErrCatalogProductImageInvalid
	}
	sort.Slice(normalized, func(left, right int) bool { return normalized[left].Ordinal < normalized[right].Ordinal })
	return normalized, nil
}

func normalizeProductName(value string) (string, error) {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if utf8.RuneCountInString(normalized) < 1 || utf8.RuneCountInString(normalized) > 160 {
		return "", ErrCatalogProductNameInvalid
	}
	return normalized, nil
}
func normalizeOptionalText(value *string, max int) (*string, error) {
	if value == nil {
		return nil, nil
	}
	normalized := strings.Join(strings.Fields(strings.TrimSpace(*value)), " ")
	if normalized == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(normalized) > max {
		return nil, ErrCatalogProductNameInvalid
	}
	return &normalized, nil
}
func validRegistryName(value string) bool {
	return utf8.RuneCountInString(value) >= 2 && utf8.RuneCountInString(value) <= 160
}
func normalizeSearch(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}

func (s *Service) requireCatalogOperator(ctx context.Context, actorID string) error {
	return s.requireOperatorPermission(ctx, actorID, "catalog")
}

func (s *Service) requireOperatorPermission(ctx context.Context, actorID, permission string) error {
	if err := s.requireOperator(ctx, actorID); err != nil {
		return err
	}
	return s.identity.RequireOperatorPermission(ctx, strings.TrimSpace(actorID), permission)
}
func (s *Service) requirePartnerIdentity(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrPartnerSessionForbidden
	}
	return identity, nil
}

func (s *Service) requirePartnerSession(ctx context.Context, accessToken string) error {
	_, err := s.requirePartnerIdentity(ctx, accessToken)
	return err
}
