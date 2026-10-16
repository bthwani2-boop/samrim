package order

import (
	"context"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ReadOperatorHomeAnalytics(ctx context.Context, actingActorID string) (postgres.OperatorHomeAnalytics, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "operations"); err != nil {
		return postgres.OperatorHomeAnalytics{}, err
	}
	return postgres.ReadOperatorHomeAnalytics(ctx, s.db)
}
