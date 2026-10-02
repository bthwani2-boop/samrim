package catalog

import (
	"context"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListCommercialStoreTypes(ctx context.Context, verticalID string, activeOnly bool) ([]postgres.CommercialStoreTypeRecord, error) {
	return postgres.ListCommercialStoreTypes(ctx, s.db, strings.TrimSpace(verticalID), activeOnly)
}

func (s *Service) ListCommercialStoreTypesForOperator(ctx context.Context, actingActorID, verticalID string, activeOnly bool) ([]postgres.CommercialStoreTypeRecord, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return s.ListCommercialStoreTypes(ctx, verticalID, activeOnly)
}

func (s *Service) CreateCommercialStoreType(ctx context.Context, actingActorID string, item postgres.CommercialStoreTypeRecord, idempotencyKey, correlationID, reason string) (postgres.CommercialStoreTypeResult, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.CommercialStoreTypeResult{}, err
	}
	item.ID = strings.ToLower(strings.TrimSpace(item.ID))
	item.VerticalID = strings.ToLower(strings.TrimSpace(item.VerticalID))
	item.NameAr = strings.Join(strings.Fields(strings.TrimSpace(item.NameAr)), " ")
	item.NameEn = strings.Join(strings.Fields(strings.TrimSpace(item.NameEn)), " ")
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	if (item.ID != "" && !verticalIDPattern.MatchString(item.ID)) || !verticalIDPattern.MatchString(item.VerticalID) || !validRegistryName(item.NameAr) || !validRegistryName(item.NameEn) || len(reason) < 5 || len(reason) > 500 || strings.TrimSpace(correlationID) == "" {
		return postgres.CommercialStoreTypeResult{}, postgres.ErrCommercialStoreTypeInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), Reason: reason}
	return postgres.CreateCommercialStoreType(ctx, s.db, item, strings.TrimSpace(idempotencyKey), postgres.HashCommercialStoreTypeCreateRequest(item, reason), audit)
}

func (s *Service) UpdateCommercialStoreType(ctx context.Context, actingActorID, storeTypeID string, input postgres.UpdateCommercialStoreTypeInput, idempotencyKey, correlationID, reason string) (postgres.CommercialStoreTypeResult, error) {
	if err := s.requireCatalogOperator(ctx, actingActorID); err != nil {
		return postgres.CommercialStoreTypeResult{}, err
	}
	storeTypeID = strings.ToLower(strings.TrimSpace(storeTypeID))
	input.NameAr = strings.Join(strings.Fields(strings.TrimSpace(input.NameAr)), " ")
	input.NameEn = strings.Join(strings.Fields(strings.TrimSpace(input.NameEn)), " ")
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	if !verticalIDPattern.MatchString(storeTypeID) || !validRegistryName(input.NameAr) || !validRegistryName(input.NameEn) || input.ExpectedVersion < 1 || len(reason) < 5 || len(reason) > 500 || strings.TrimSpace(correlationID) == "" {
		return postgres.CommercialStoreTypeResult{}, postgres.ErrCommercialStoreTypeInvalid
	}
	audit := postgres.CatalogRegistryAuditInput{ActingActorID: strings.TrimSpace(actingActorID), CorrelationID: strings.TrimSpace(correlationID), Reason: reason}
	return postgres.UpdateCommercialStoreType(ctx, s.db, storeTypeID, input, strings.TrimSpace(idempotencyKey), postgres.HashCommercialStoreTypeUpdateRequest(storeTypeID, input, reason), audit)
}
