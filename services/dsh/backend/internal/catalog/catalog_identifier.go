package catalog

import (
	"context"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ResolveCatalogIdentifierForPartner(ctx context.Context, accessToken, storeID, identifierValue string) (postgres.CatalogIdentifierResolution, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogIdentifierResolution{}, err
	}
	return postgres.ResolveCatalogIdentifier(ctx, s.db, storeID, identifierValue)
}
