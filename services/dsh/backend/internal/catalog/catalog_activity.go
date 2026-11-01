package catalog

import (
	"context"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"strings"
)

// Cross-store catalog history requires both catalog and partner management grants; other histories retain their owners.
func (s *Service) ListActivityForOperator(ctx context.Context, actorID string, filter postgres.CatalogActivityFilter) (postgres.CatalogActivityPage, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.CatalogActivityPage{}, err
	}
	if err := s.requireOperatorPermission(ctx, actorID, "partners"); err != nil {
		return postgres.CatalogActivityPage{}, err
	}
	return postgres.ListCatalogActivity(ctx, s.db, filter)
}

// Partner history reads only immutable store-offer audit rows; historical product ownership is not persisted in product audit rows.
func (s *Service) ListActivityForPartner(ctx context.Context, token, storeID string, filter postgres.CatalogActivityFilter) (postgres.CatalogActivityPage, error) {
	scope := strings.TrimSpace(storeID)
	if _, err := s.requireStoreOwner(ctx, token, scope); err != nil {
		return postgres.CatalogActivityPage{}, err
	}
	filter.StoreID = scope
	filter.Kind = "offer"
	return postgres.ListCatalogActivity(ctx, s.db, filter)
}
