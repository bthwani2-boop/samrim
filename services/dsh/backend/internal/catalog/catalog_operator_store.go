package catalog

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Operator Store catalog actions use the same canonical Product and StoreOffer writers
// as the Partner app, but retain the actual Operator actor in the audit trail.
func (s *Service) operatorStoreVertical(ctx context.Context, actorID, storeID string) (string, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "partners"); err != nil {
		return "", err
	}
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return "", postgres.ErrCatalogOfferStoreNotFound
	}
	var vertical string
	err := s.db.QueryRowContext(ctx, "SELECT primary_vertical_id FROM dsh.stores WHERE id=$1", storeID).Scan(&vertical)
	if errors.Is(err, sql.ErrNoRows) {
		return "", postgres.ErrCatalogOfferStoreNotFound
	}
	return vertical, err
}

func (s *Service) ListSharedProductsForOperatorStore(ctx context.Context, actorID, storeID, query string, limit int, cursor string) (postgres.CatalogProductPage, error) {
	vertical, err := s.operatorStoreVertical(ctx, actorID, storeID)
	if err != nil {
		return postgres.CatalogProductPage{}, err
	}
	return postgres.ListCatalogProducts(ctx, s.db, normalizeSearch(query), vertical, true, limit, strings.TrimSpace(cursor))
}

func (s *Service) CreateStoreProductForOperator(ctx context.Context, actorID, storeID string, input postgres.CatalogProductInput, key, correlation string) (postgres.CatalogProductResult, error) {
	vertical, err := s.operatorStoreVertical(ctx, actorID, storeID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	input.VerticalID = vertical
	input.StoreID = strings.TrimSpace(storeID)
	input.Scope = "STORE_SCOPED"
	normalized, err := normalizeCatalogProductInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	return postgres.CreateCatalogProduct(ctx, s.db, normalized, strings.TrimSpace(key), postgres.HashCatalogProductCreateRequest(normalized), strings.TrimSpace(actorID), strings.TrimSpace(correlation))
}

func (s *Service) CreateStoreOfferForOperator(ctx context.Context, actorID, storeID string, input postgres.CatalogOfferInput, key, correlation string) (postgres.CatalogStoreOfferResult, error) {
	if _, err := s.operatorStoreVertical(ctx, actorID, storeID); err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	input.StoreID = strings.TrimSpace(storeID)
	return postgres.CreateCatalogOfferWithProvenance(ctx, s.db, input, strings.TrimSpace(key), postgres.HashCatalogOfferCreateRequest(input), strings.TrimSpace(actorID), strings.TrimSpace(correlation), "CONTROL_PANEL")
}

func (s *Service) UpdateStoreOfferForOperator(ctx context.Context, actorID, storeID, offerID string, input postgres.CatalogOfferUpdateInput, version int, key, correlation string) (postgres.CatalogStoreOfferResult, error) {
	if _, err := s.operatorStoreVertical(ctx, actorID, storeID); err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	current, err := postgres.ReadCatalogOffer(ctx, s.db, strings.TrimSpace(offerID))
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	if current.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogStoreOfferResult{}, ErrStoreOwnershipForbidden
	}
	return postgres.UpdateCatalogOfferWithProvenance(ctx, s.db, strings.TrimSpace(offerID), input, version, strings.TrimSpace(key), postgres.HashCatalogOfferUpdateRequest(offerID, input, version), strings.TrimSpace(actorID), strings.TrimSpace(correlation), "CONTROL_PANEL")
}

func (s *Service) ReadStoreProductForOperator(ctx context.Context, actorID, storeID, productID string) (postgres.CatalogProductRecord, error) {
	vertical, err := s.operatorStoreVertical(ctx, actorID, storeID)
	if err != nil {
		return postgres.CatalogProductRecord{}, err
	}
	product, err := postgres.ReadCatalogProduct(ctx, s.db, strings.TrimSpace(productID))
	if err != nil {
		return postgres.CatalogProductRecord{}, err
	}
	if product.VerticalID != vertical || (product.Scope != "SHARED" && (product.Scope != "STORE_SCOPED" || product.StoreID != strings.TrimSpace(storeID))) {
		return postgres.CatalogProductRecord{}, postgres.ErrCatalogProductOwnership
	}
	return product, nil
}
func (s *Service) UpdateStoreProductForOperator(ctx context.Context, actorID, storeID, productID string, input postgres.CatalogProductUpdateInput, version int, key, correlation string) (postgres.CatalogProductResult, error) {
	current, err := s.ReadStoreProductForOperator(ctx, actorID, storeID, productID)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	if current.Scope != "STORE_SCOPED" {
		return postgres.CatalogProductResult{}, postgres.ErrCatalogProductOwnership
	}
	input.Scope = "STORE_SCOPED"
	input.StoreID = strings.TrimSpace(storeID)
	input.VerticalID = current.VerticalID
	normalized, err := normalizeCatalogProductUpdateInput(input)
	if err != nil {
		return postgres.CatalogProductResult{}, err
	}
	return postgres.UpdateCatalogProduct(ctx, s.db, strings.TrimSpace(productID), normalized, version, strings.TrimSpace(key), postgres.HashCatalogProductUpdateRequest(productID, normalized, version), strings.TrimSpace(actorID), strings.TrimSpace(correlation))
}
