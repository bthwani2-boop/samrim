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
