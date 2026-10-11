package storepublication

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) requireStoreTrashOperator(ctx context.Context, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	operator, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return s.identity.RequireOperatorPermission(ctx, actorID, "partners")
}

func (s *Service) ListDeletedStores(ctx context.Context, actorID string, limit int, cursor string) (postgres.DeletedStorePage, error) {
	if err := s.requireStoreTrashOperator(ctx, actorID); err != nil {
		return postgres.DeletedStorePage{}, err
	}
	return postgres.ListDeletedStores(ctx, s.db, limit, cursor)
}

func (s *Service) SetStoreTrash(ctx context.Context, actorID, storeID, action, reason, key string, version int) (postgres.DeletedStore, bool, error) {
	if err := s.requireStoreTrashOperator(ctx, actorID); err != nil {
		return postgres.DeletedStore{}, false, err
	}
	return postgres.SetStoreTrashed(ctx, s.db, storeID, actorID, reason, action, key, version)
}
