package storepublication

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// SuspendIndependent is an operator-only safety control. It cannot make a
// Store public or bypass Legal/Media/Policy release gates.
func (s *Service) SuspendIndependent(ctx context.Context, storeID, operatorActorID, reason string, expectedVersion int, key, correlationID string) (postgres.IndependentPublicationSuspension, error) {
	operatorActorID = strings.TrimSpace(operatorActorID)
	role, err := s.identity.ReadActorRole(ctx, operatorActorID, "operator")
	if err != nil {
		return postgres.IndependentPublicationSuspension{}, err
	}
	if role.Role != "operator" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil {
		return postgres.IndependentPublicationSuspension{}, ErrOperatorNotActive
	}
	if err := s.identity.RequireOperatorPermission(ctx, operatorActorID, "partners"); err != nil {
		return postgres.IndependentPublicationSuspension{}, err
	}
	return postgres.SuspendIndependentPublication(ctx, s.db, storeID, operatorActorID, reason, expectedVersion, key, correlationID)
}
