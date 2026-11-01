package storeaccess

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// The Store's authorized owner is the only writer. A delegated employee does
// not gain public-contact authority through catalog or order permissions.
func (s *Service) ReadPublicContactForOwner(ctx context.Context, accessToken, storeID string) (postgres.StorePublicContact, error) {
	actor, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StorePublicContact{}, err
	}
	return postgres.ReadStorePublicContactForOwner(ctx, s.db, strings.TrimSpace(storeID), actor)
}

func (s *Service) UpdatePublicContactForOwner(ctx context.Context, accessToken, storeID string, input postgres.StorePublicContactInput, idempotencyKey, correlationID string) (postgres.StorePublicContact, bool, error) {
	actor, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StorePublicContact{}, false, err
	}
	return postgres.UpdateStorePublicContactForOwner(ctx, s.db, strings.TrimSpace(storeID), actor, input, idempotencyKey, correlationID)
}

func (s *Service) ReadPublicContactForOperator(ctx context.Context, operatorID, storeID string) (postgres.StorePublicContact, error) {
	if err := s.requirePartnerAdmissionOperator(ctx, operatorID); err != nil {
		return postgres.StorePublicContact{}, err
	}
	return postgres.ReadStorePublicContactForOperator(ctx, s.db, strings.TrimSpace(storeID))
}

func (s *Service) ReadPublishedPublicContact(ctx context.Context, storeID string) (postgres.StorePublicContact, error) {
	return postgres.ReadPublishedStorePublicContact(ctx, s.db, strings.TrimSpace(storeID))
}
