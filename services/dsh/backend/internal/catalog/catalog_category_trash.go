package catalog

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListDeletedCategoriesForOperator(ctx context.Context, actorID string, limit int, cursor string) (postgres.DeletedCatalogCategoryPage, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.DeletedCatalogCategoryPage{}, err
	}
	return postgres.ListDeletedCatalogCategories(ctx, s.db, limit, cursor)
}

func (s *Service) SetCategoryTrashedForOperator(ctx context.Context, actorID, categoryID, reason, action, key string, version int) (postgres.DeletedCatalogCategory, bool, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "catalog"); err != nil {
		return postgres.DeletedCatalogCategory{}, false, err
	}
	return postgres.SetCatalogCategoryTrashed(ctx, s.db, categoryID, strings.TrimSpace(actorID), reason, action, key, version)
}
