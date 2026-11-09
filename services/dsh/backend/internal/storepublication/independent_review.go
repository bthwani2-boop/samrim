package storepublication

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// DecideIndependentReview is restricted to non-publishing safety decisions.
func (s *Service) DecideIndependentReview(ctx context.Context, storeID, operatorID, action,
	reason string, expectedVersion int, key, correlation string) (postgres.IndependentPublicationReviewDecision, error) {
	operatorID = strings.TrimSpace(operatorID)
	role, err := s.identity.ReadActorRole(ctx, operatorID, "operator")
	if err != nil {
		return postgres.IndependentPublicationReviewDecision{}, err
	}
	if role.Role != "operator" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil {
		return postgres.IndependentPublicationReviewDecision{}, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, operatorID, "partners"); err != nil {
		return postgres.IndependentPublicationReviewDecision{}, err
	}
	return postgres.DecideIndependentPublicationReview(ctx, s.db, storeID, operatorID, action, reason, expectedVersion, key, correlation)
}
