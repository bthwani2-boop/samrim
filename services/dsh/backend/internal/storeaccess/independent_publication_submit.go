package storeaccess

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// SubmitIndependentPublicationForOwner authenticates the Partner session; the
// trusted runtime-supplied legal version never comes from merchant UI input.
func (s *Service) SubmitIndependentPublicationForOwner(ctx context.Context, bearer, storeID,
	approvedTermsVersion string, expectedVersion int, key, correlation string) (postgres.IndependentPublicationSubmission, error) {
	actorID, err := s.partnerActor(ctx, bearer)
	if err != nil {
		return postgres.IndependentPublicationSubmission{}, err
	}
	return postgres.SubmitIndependentPublicationForOwner(ctx, s.db, strings.TrimSpace(storeID),
		actorID, approvedTermsVersion, expectedVersion, key, correlation)
}
