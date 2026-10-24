package order

import (
	"context"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListStageSLAPoliciesForOperator(ctx context.Context, actingActorID string) ([]postgres.StageSLAPolicy, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "platform_policies"); err != nil {
		return nil, err
	}
	return postgres.ReadOperatorStageSLAPolicies(ctx, s.db)
}
func (s *Service) ApproveStageSLAPolicyForOperator(ctx context.Context, actingActorID string, input postgres.StageSLAPolicyInput, key, correlation string) (postgres.StageSLAPolicy, bool, error) {
	if err := s.requireOperatorPermission(ctx, actingActorID, "platform_policies"); err != nil {
		return postgres.StageSLAPolicy{}, false, err
	}
	return postgres.CreateOperatorStageSLAPolicy(ctx, s.db, input, actingActorID, key, correlation)
}
