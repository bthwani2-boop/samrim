package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var ErrFieldCatalogSessionForbidden = errors.New("an active Field app session is required for pre-Go-Live catalog work")

type FieldCatalogReadback struct {
	Scope    postgres.FieldCatalogScope
	Products []postgres.CatalogProductRecord
	Offers   postgres.CatalogStoreOfferPage
}

func (s *Service) ListFieldCatalog(ctx context.Context, accessToken, joiningCaseID, query string, limit int, cursor string) (FieldCatalogReadback, error) {
	_, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return FieldCatalogReadback{}, err
	}
	products, err := postgres.ListCatalogProductsForField(ctx, s.db, scope, query, limit)
	if err != nil {
		return FieldCatalogReadback{}, err
	}
	offers, err := postgres.ListCatalogOfferPage(ctx, s.db, scope.StoreID, limit, cursor)
	if err != nil {
		return FieldCatalogReadback{}, err
	}
	return FieldCatalogReadback{Scope: scope, Products: products, Offers: offers}, nil
}

func (s *Service) ListQuickPricesForField(ctx context.Context, accessToken, joiningCaseID string, filters postgres.CatalogQuickPriceFilters, limit int, cursor string) (postgres.CatalogStoreOfferPage, error) {
	_, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogStoreOfferPage{}, err
	}
	return postgres.ListCatalogQuickPriceOffers(ctx, s.db, scope.StoreID, filters, limit, cursor)
}

func (s *Service) UpdateQuickPricesForField(ctx context.Context, accessToken, joiningCaseID string, changes []postgres.CatalogQuickPriceUpdateInput, idempotencyKey, correlationID string) ([]postgres.CatalogQuickPriceUpdateResult, error) {
	identity, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return nil, err
	}
	return s.applyQuickPrices(ctx, identity, scope.StoreID, changes, idempotencyKey, correlationID)
}

func (s *Service) ResolveCatalogIdentifierForPartner(ctx context.Context, accessToken, storeID, identifierValue string) (postgres.CatalogIdentifierResolution, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogIdentifierResolution{}, err
	}
	return postgres.ResolveCatalogIdentifier(ctx, s.db, storeID, identifierValue)
}

func (s *Service) ResolveCatalogIdentifierForField(ctx context.Context, accessToken, joiningCaseID, identifierValue string) (postgres.CatalogIdentifierResolution, error) {
	_, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogIdentifierResolution{}, err
	}
	return postgres.ResolveCatalogIdentifier(ctx, s.db, scope.StoreID, identifierValue)
}

func (s *Service) CreateFieldCatalogProduct(ctx context.Context, accessToken, joiningCaseID string, input postgres.CatalogProductInput, idempotencyKey, correlationID string) (postgres.CatalogProductResult, error) {
	identity, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	input.VerticalID = scope.VerticalID
	input.Scope = "STORE_SCOPED"
	input.StoreID = scope.StoreID
	normalized, err := normalizeCatalogProductInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	return postgres.CreateCatalogProduct(ctx, s.db, normalized, strings.TrimSpace(idempotencyKey), postgres.HashCatalogProductCreateRequest(normalized), identity, strings.TrimSpace(correlationID))
}

func (s *Service) CreateFieldCatalogOffer(ctx context.Context, accessToken, joiningCaseID string, input postgres.CatalogOfferInput, idempotencyKey, correlationID string) (postgres.CatalogStoreOfferResult, error) {
	identity, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	input.StoreID = scope.StoreID
	requestHash := postgres.HashCatalogOfferCreateRequest(input)
	return postgres.CreateCatalogOfferWithProvenance(ctx, s.db, input, strings.TrimSpace(idempotencyKey), requestHash, identity, strings.TrimSpace(correlationID), "FIELD_INITIAL_CATALOG")
}

func (s *Service) UpdateFieldCatalogOffer(ctx context.Context, accessToken, joiningCaseID, offerID string, input postgres.CatalogOfferUpdateInput, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogStoreOfferResult, error) {
	identity, scope, err := s.requireFieldCatalog(ctx, accessToken, joiningCaseID)
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	current, err := postgres.ReadCatalogOffer(ctx, s.db, offerID)
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	if current.StoreID != scope.StoreID {
		return postgres.CatalogStoreOfferResult{}, postgres.ErrCatalogProductOwnership
	}
	return postgres.UpdateCatalogOfferWithProvenance(ctx, s.db, offerID, input, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogOfferUpdateRequest(offerID, input, expectedVersion), identity, strings.TrimSpace(correlationID), "FIELD_INITIAL_CATALOG")
}

func (s *Service) requireFieldCatalog(ctx context.Context, accessToken, joiningCaseID string) (string, postgres.FieldCatalogScope, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", postgres.FieldCatalogScope{}, err
	}
	if identity.Role != "field" || identity.Surface != "app-field" || strings.TrimSpace(identity.Subject) == "" {
		return "", postgres.FieldCatalogScope{}, ErrFieldCatalogSessionForbidden
	}
	scope, err := postgres.AuthorizeFieldCatalogCase(ctx, s.db, joiningCaseID, identity.Subject)
	if err != nil {
		return "", postgres.FieldCatalogScope{}, err
	}
	return identity.Subject, scope, nil
}
