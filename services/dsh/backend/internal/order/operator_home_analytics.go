package order

import (
	"context"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ReadOperatorHomeAnalytics(ctx context.Context, actingActorID string) (postgres.OperatorHomeAnalytics, error) {
	return s.ReadOperatorAnalyticsPeriod(ctx, actingActorID, 7)
}

func (s *Service) ReadOperatorAnalyticsPeriod(ctx context.Context, actingActorID string, days int) (postgres.OperatorHomeAnalytics, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "operations"); err != nil {
		return postgres.OperatorHomeAnalytics{}, err
	}
	return postgres.ReadOperatorAnalyticsPeriod(ctx, s.db, days)
}
