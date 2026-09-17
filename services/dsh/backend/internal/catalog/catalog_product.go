package catalog

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrOperatorNotActive               = errors.New("operator actor is not active")
	ErrPartnerSessionForbidden         = errors.New("an active app-partner session is required")
	ErrStoreOwnershipForbidden         = errors.New("partner does not own this store")
	ErrCatalogProductNameInvalid       = errors.New("catalog Product name is invalid")
	ErrCatalogProductIdentifierInvalid = errors.New("catalog Product identifier is invalid")
	ErrCatalogProductImageInvalid      = errors.New("catalog Product image URL is invalid")
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
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("catalog configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) ListProductsForPartner(ctx context.Context, accessToken, query, verticalID string, limit int) ([]postgres.CatalogProductRecord, error) {
	identity, err := s.requirePartnerIdentity(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return postgres.ListCatalogProductsForPartner(ctx, s.db, normalizeSearch(query), strings.TrimSpace(verticalID), identity.Subject, limit)
}

func (s *Service) ListProductsForOperator(ctx context.Context, actingActorID, query, verticalID string, limit int) ([]postgres.CatalogProductRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return postgres.ListCatalogProducts(ctx, s.db, normalizeSearch(query), strings.TrimSpace(verticalID), false, limit)
}

func (s *Service) ListVerticals(ctx context.Context, activeOnly bool) ([]postgres.CommerceVerticalRecord, error) {
	return postgres.ListCommerceVerticals(ctx, s.db, activeOnly)
}

func (s *Service) CreateVertical(ctx context.Context, actingActorID string, item postgres.CommerceVerticalRecord, idempotencyKey, correlationID string) (postgres.CommerceVerticalResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CommerceVerticalResult{}, err
	}
	item.ID = strings.ToLower(strings.TrimSpace(item.ID))
	item.NameAr = strings.Join(strings.Fields(strings.TrimSpace(item.NameAr)), " ")
	item.NameEn = strings.Join(strings.Fields(strings.TrimSpace(item.NameEn)), " ")
	if (item.ID != "" && !verticalIDPattern.MatchString(item.ID)) || !validRegistryName(item.NameAr) || !validRegistryName(item.NameEn) {
		return postgres.CommerceVerticalResult{}, ErrCatalogVerticalInvalid
	}
	return postgres.CreateCommerceVertical(ctx, s.db, item, strings.TrimSpace(idempotencyKey), postgres.HashCatalogVerticalCreateRequest(item))
}

func (s *Service) ListCategories(ctx context.Context, verticalID string, activeOnly bool) ([]postgres.CatalogCategoryRecord, error) {
	if strings.TrimSpace(verticalID) == "" {
		return nil, postgres.ErrCatalogVerticalNotFound
	}
	return postgres.ListCatalogCategories(ctx, s.db, strings.TrimSpace(verticalID), activeOnly)
}

func (s *Service) CreateCategory(ctx context.Context, actingActorID string, item postgres.CatalogCategoryRecord, idempotencyKey string) (postgres.CatalogCategoryRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogCategoryRecord{}, err
	}
	item.ID = strings.ToLower(strings.TrimSpace(item.ID))
	item.VerticalID = strings.TrimSpace(item.VerticalID)
	item.ParentCategoryID = strings.TrimSpace(item.ParentCategoryID)
	item.NameAr = strings.Join(strings.Fields(strings.TrimSpace(item.NameAr)), " ")
	item.NameEn = strings.Join(strings.Fields(strings.TrimSpace(item.NameEn)), " ")
	if (item.ID != "" && !verticalIDPattern.MatchString(item.ID)) || !verticalIDPattern.MatchString(item.VerticalID) || (item.ParentCategoryID != "" && !verticalIDPattern.MatchString(item.ParentCategoryID)) || !validRegistryName(item.NameAr) || !validRegistryName(item.NameEn) {
		return postgres.CatalogCategoryRecord{}, ErrCatalogCategoryInvalid
	}
	return postgres.CreateCatalogCategory(ctx, s.db, item, strings.TrimSpace(idempotencyKey), postgres.HashCatalogCategoryCreateRequest(item))
}

func (s *Service) CreateCatalogProduct(ctx context.Context, actingActorID string, input postgres.CatalogProductInput, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogProductResult{}, err
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
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogVariantResult{}, err
	}
	if strings.TrimSpace(input.ID) == "" {
		return postgres.CatalogVariantResult{}, postgres.ErrCatalogIdentifierInvalid
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
	if err := s.requireOperator(ctx, actingActorID); err != nil {
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
	if err := s.requireOperator(ctx, actingActorID); err != nil {
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

func (s *Service) ReadCatalogProduct(ctx context.Context, actingActorID, productID string) (postgres.CatalogProductRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogProductRecord{}, err
	}
	return postgres.ReadCatalogProduct(ctx, s.db, strings.TrimSpace(productID))
}

func (s *Service) ReadCatalogVariant(ctx context.Context, actingActorID, variantID string) (postgres.CatalogVariantRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogVariantRecord{}, err
	}
	return postgres.ReadCatalogVariant(ctx, s.db, strings.TrimSpace(variantID))
}

func (s *Service) ReadAttributeRules(ctx context.Context, actingActorID, categoryID string) ([]postgres.CatalogAttributeRuleRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return postgres.ReadCatalogAttributeRules(ctx, s.db, strings.TrimSpace(categoryID))
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
	return postgres.CatalogProductInput{ID: strings.TrimSpace(input.ID), VerticalID: verticalID, Scope: scope, StoreID: strings.TrimSpace(input.StoreID), CanonicalName: name, Brand: brand, VariantTitle: variantTitle, MeasurementKind: measurementKind, BaseUnit: baseUnit, CategoryIDs: categories, IdentifierType: identifierType, IdentifierValue: identifierValue, ImageURI: image}, nil
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
	verticalID := strings.TrimSpace(input.VerticalID)
	scope := strings.ToUpper(strings.TrimSpace(input.Scope))
	if verticalID == "" || (scope != "SHARED" && scope != "STORE_SCOPED") {
		return postgres.CatalogProductUpdateInput{}, ErrCatalogProductScopeInvalid
	}
	return postgres.CatalogProductUpdateInput{VerticalID: verticalID, Scope: scope, StoreID: strings.TrimSpace(input.StoreID), CanonicalName: name, Brand: brand, Active: input.Active}, nil
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
