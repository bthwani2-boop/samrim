package joiningcase

import (
	"context"
	"strings"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func (s *Service) requireCommercialModelPolicyAuthority(ctx context.Context, actingActorID string) error {
	actor := strings.TrimSpace(actingActorID)
	if err := s.requireFinance(ctx, actor); err != nil {
		return err
	}
	if err := s.identity.RequireOperatorPermission(ctx, actor, "platform_policies"); err != nil {
		return err
	}
	return s.identity.RequireOperatorPermission(ctx, actor, "partners")
}

func (s *Service) ReadStoreRelationCommercialModelDefaultsForOperator(ctx context.Context, actorID string) ([]wltintegration.StoreRelationCommercialModelDefault, error) {
	if err := s.requireCommercialModelPolicyAuthority(ctx, actorID); err != nil {
		return nil, err
	}
	return s.wlt.ReadStoreRelationCommercialModelDefaults(ctx)
}

func (s *Service) UpdateStoreRelationCommercialModelDefaultForOperator(ctx context.Context, actorID string, input wltintegration.StoreRelationCommercialModelDefaultUpdate, idempotencyKey, correlationID string) (wltintegration.StoreRelationCommercialModelDefault, bool, error) {
	if err := s.requireCommercialModelPolicyAuthority(ctx, actorID); err != nil {
		return wltintegration.StoreRelationCommercialModelDefault{}, false, err
	}
	if !validStoreAgreementMutationHeaders(idempotencyKey, correlationID) ||
		(input.RelationModel != "BTHWANI_PARTNER" && input.RelationModel != "INDEPENDENT_STORE") ||
		(input.CommercialModel != "COMMISSION" && input.CommercialModel != "SUBSCRIPTION") ||
		input.ExpectedVersion < 0 || !validStoreAgreementReason(input.Reason) {
		return wltintegration.StoreRelationCommercialModelDefault{}, false, ErrStoreAgreementInvalidInput
	}
	item, replayed, err := s.wlt.UpdateStoreRelationCommercialModelDefault(ctx, input, idempotencyKey, correlationID, strings.TrimSpace(actorID))
	if err != nil {
		return wltintegration.StoreRelationCommercialModelDefault{}, false, err
	}
	if item.RelationModel != input.RelationModel || item.CommercialModel != input.CommercialModel || item.PolicyVersion < input.ExpectedVersion {
		return wltintegration.StoreRelationCommercialModelDefault{}, false, ErrStoreAgreementState
	}
	return item, replayed, nil
}
