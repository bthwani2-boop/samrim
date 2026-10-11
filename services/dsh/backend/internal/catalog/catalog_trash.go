package catalog

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListDeletedProductsForOperator(ctx context.Context, actorID string, limit int, cursor string) (postgres.DeletedCatalogProductPage, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.DeletedCatalogProductPage{}, err
	}
	return postgres.ListDeletedCatalogProducts(ctx, s.db, limit, cursor)
}

func (s *Service) SetProductTrashedForOperator(ctx context.Context, actorID, productID, reason, action, idempotencyKey string, expectedVersion int) (postgres.DeletedCatalogProduct, bool, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.DeletedCatalogProduct{}, false, err
	}
	return postgres.SetCatalogProductTrashed(ctx, s.db, productID, strings.TrimSpace(actorID), reason, action, idempotencyKey, expectedVersion)
}

func (s *Service) ListDeletedProductsForStore(ctx context.Context, token, storeID string, limit int, cursor string) (postgres.DeletedCatalogProductPage, error) {
	if _, err := s.requireStoreOwner(ctx, token, storeID); err != nil {
		return postgres.DeletedCatalogProductPage{}, err
	}
	return postgres.ListDeletedCatalogProductsForStore(ctx, s.db, storeID, limit, cursor)
}

func (s *Service) SetStoreProductTrashed(ctx context.Context, token, storeID, productID, reason, action, key string, expectedVersion int) (postgres.DeletedCatalogProduct, bool, error) {
	actorID, err := s.requireStoreOwner(ctx, token, storeID)
	if err != nil {
		return postgres.DeletedCatalogProduct{}, false, err
	}
	return postgres.SetStoreScopedProductTrashed(ctx, s.db, storeID, productID, actorID, reason, action, key, expectedVersion)
}
