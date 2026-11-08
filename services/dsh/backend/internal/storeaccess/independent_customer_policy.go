package storeaccess

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// ReadIndependentCustomerPolicyForOwner returns only the authenticated
// Partner's own merchant-authored terms. It never reveals draft terms to
// delegates, customer sessions, or a foreign Store owner.
func (s *Service) ReadIndependentCustomerPolicyForOwner(ctx context.Context, token, storeID string) (postgres.IndependentCustomerPolicyRecord, error) {
	actorID, err := s.partnerActor(ctx, token)
	if err != nil {
		return postgres.IndependentCustomerPolicyRecord{}, err
	}
	return postgres.ReadIndependentCustomerPolicyForOwner(ctx, s.db, strings.TrimSpace(storeID), actorID)
}

// SaveIndependentCustomerPolicyDraftForOwner is draft-only. The canonical DSH
// persistence layer enforces Store ownership, optimistic version, idempotency
// and durable audit while revoking any prior policy review on draft change.
// No caller can approve or publish a merchant policy through this method.
func (s *Service) SaveIndependentCustomerPolicyDraftForOwner(ctx context.Context, token, storeID string, input postgres.IndependentCustomerPolicyDraftInput, key, correlationID string) (postgres.IndependentCustomerPolicyRecord, bool, error) {
	actorID, err := s.partnerActor(ctx, token)
	if err != nil {
		return postgres.IndependentCustomerPolicyRecord{}, false, err
	}
	key, correlationID = strings.TrimSpace(key), strings.TrimSpace(correlationID)
	if len(key) < 16 || !validMutation(key, correlationID) {
		return postgres.IndependentCustomerPolicyRecord{}, false, postgres.ErrIndependentCustomerPolicyInvalid
	}
	return postgres.SaveIndependentCustomerPolicyDraftForOwner(ctx, s.db, strings.TrimSpace(storeID), actorID, input, key, correlationID)
}
