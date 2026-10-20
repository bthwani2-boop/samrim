package catalog

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// Store-Type cancellation policy is a platform-policy decision; Catalog
// permissions alone never grant authority to change it.
func (s *Service) UpdateStoreTypeCancellationPolicy(ctx context.Context, actorID, storeTypeID, mode, reason, idempotencyKey, correlationID string, expectedVersion int) (postgres.CommercialStoreTypeRecord, bool, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "platform_policies"); err != nil {
		return postgres.CommercialStoreTypeRecord{}, false, err
	}
	return postgres.UpdateStoreTypeCancellationMode(ctx, s.db, strings.TrimSpace(storeTypeID),
		strings.TrimSpace(mode), strings.TrimSpace(reason), strings.TrimSpace(actorID),
		strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID), expectedVersion)
}
