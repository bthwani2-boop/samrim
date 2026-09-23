package locationcore

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) SetStoreFulfillmentModes(ctx context.Context, accessToken, storeID string, modes []string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreFulfillmentModesResult, error) {
	partnerActorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.StoreFulfillmentModesResult{}, err
	}
	storeID = strings.TrimSpace(storeID)
	return postgres.SetStoreFulfillmentModes(ctx, s.db, storeID, partnerActorID, modes, expectedVersion, idempotencyKey, correlationID)
}
