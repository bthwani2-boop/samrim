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
)

var (
	ErrOperatorNotActive               = errors.New("operator actor is not active")
	ErrPartnerSessionForbidden         = errors.New("an active app-partner session is required")
	ErrStoreOwnershipForbidden         = errors.New("partner does not own this store")
	ErrCatalogProductNameInvalid       = errors.New("catalog Product name is invalid")
	ErrCatalogProductIdentifierInvalid = errors.New("catalog Product identifier is invalid")
	ErrCatalogProductImageInvalid      = errors.New("catalog Product image URL is invalid")
	ErrCatalogProductSellUnitInvalid   = errors.New("catalog Product sell unit is invalid")
	ErrCatalogProductScopeInvalid      = errors.New("catalog Product scope is invalid")
	ErrCatalogProductVerticalInvalid   = errors.New("catalog Product vertical is invalid")
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

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
	if err := s.requirePartnerSession(ctx, accessToken); err != nil {
		return nil, err
	}
	return postgres.ListCatalogProducts(ctx, s.db, normalizeSearch(query), strings.TrimSpace(verticalID), true, limit)
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
	if item.ID == "" || item.NameAr == "" || item.NameEn == "" {
		return postgres.CommerceVerticalResult{}, ErrCatalogProductVerticalInvalid
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
	if item.ID == "" || item.VerticalID == "" || item.NameAr == "" || item.NameEn == "" {
		return postgres.CatalogCategoryRecord{}, postgres.ErrCatalogCategoryNotFound
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
	sellUnit := strings.ToLower(strings.TrimSpace(input.SellUnit))
	if sellUnit != "piece" && sellUnit != "kg" {
		return postgres.CatalogProductInput{}, ErrCatalogProductSellUnitInvalid
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
	return postgres.CatalogProductInput{ID: strings.TrimSpace(input.ID), VerticalID: verticalID, Scope: scope, CanonicalName: name, Brand: brand, SellUnit: sellUnit, VariantTitle: variantTitle, CategoryIDs: categories, IdentifierType: identifierType, IdentifierValue: identifierValue, ImageURI: image}, nil
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
	return postgres.CatalogProductUpdateInput{VerticalID: verticalID, Scope: scope, CanonicalName: name, Brand: brand, Active: input.Active}, nil
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
func (s *Service) requirePartnerSession(ctx context.Context, accessToken string) error {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return ErrPartnerSessionForbidden
	}
	return nil
}
