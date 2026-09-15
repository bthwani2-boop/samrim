package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) CreateAttributeDefinition(ctx context.Context, actingActorID string, input postgres.CatalogAttributeDefinitionInput, idempotencyKey string) (postgres.CatalogAttributeDefinitionRecord, bool, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogAttributeDefinitionRecord{}, false, err
	}
	return postgres.CreateCatalogAttributeDefinition(ctx, s.db, input, strings.TrimSpace(idempotencyKey), postgres.HashCatalogAttributeDefinitionRequest(input))
}

func (s *Service) ListAttributeDefinitions(ctx context.Context, verticalID string) ([]postgres.CatalogAttributeDefinitionRecord, error) {
	if strings.TrimSpace(verticalID) == "" {
		return nil, postgres.ErrCatalogVerticalNotFound
	}
	return postgres.ListCatalogAttributeDefinitions(ctx, s.db, verticalID, true)
}

func (s *Service) ListAttributeDefinitionsForOperator(ctx context.Context, actingActorID, verticalID string) ([]postgres.CatalogAttributeDefinitionRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return s.ListAttributeDefinitions(ctx, verticalID)
}

func (s *Service) ListAttributeEnumOptions(ctx context.Context, actingActorID, attributeID string) ([]postgres.CatalogAttributeEnumOptionRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return postgres.ListCatalogAttributeEnumOptions(ctx, s.db, attributeID, true)
}

func (s *Service) CreateAttributeEnumOption(ctx context.Context, actingActorID, attributeID string, input postgres.CatalogAttributeEnumOptionInput, idempotencyKey string) (postgres.CatalogAttributeEnumOptionRecord, bool, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.CatalogAttributeEnumOptionRecord{}, false, err
	}
	input.AttributeID = strings.TrimSpace(attributeID)
	input.OptionValue = strings.Join(strings.Fields(strings.TrimSpace(input.OptionValue)), " ")
	if input.OptionValue == "" || input.Ordinal < 0 || input.Ordinal > 100 {
		return postgres.CatalogAttributeEnumOptionRecord{}, false, ErrCatalogModifierInvalid
	}
	return postgres.CreateCatalogAttributeEnumOption(ctx, s.db, input, strings.TrimSpace(idempotencyKey), postgres.HashCatalogAttributeEnumOptionRequest(input))
}

func (s *Service) UpsertProductAttribute(ctx context.Context, actingActorID, productID string, input postgres.CatalogAttributeValueInput) error {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return err
	}
	return postgres.UpsertCatalogProductAttributeValue(ctx, s.db, productID, input)
}

func (s *Service) UpsertVariantAttribute(ctx context.Context, actingActorID, variantID string, input postgres.CatalogAttributeValueInput) error {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return err
	}
	return postgres.UpsertCatalogVariantAttributeValue(ctx, s.db, variantID, input)
}

func (s *Service) UpsertCategoryAttributeRule(ctx context.Context, actingActorID string, rule postgres.CatalogAttributeRuleRecord) error {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return err
	}
	return postgres.UpsertCatalogCategoryAttributeRule(ctx, s.db, rule)
}

func (s *Service) CreateModifierGroup(ctx context.Context, accessToken, storeID string, input postgres.CatalogModifierGroupInput) (postgres.CatalogModifierGroupRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogModifierGroupRecord{}, err
	}
	input.NameAr = strings.Join(strings.Fields(strings.TrimSpace(input.NameAr)), " ")
	if input.NameAr == "" || input.MinSelections < 0 || input.MaxSelections < input.MinSelections || input.MaxSelections > 100 || (input.Required && input.MinSelections == 0) {
		return postgres.CatalogModifierGroupRecord{}, ErrCatalogModifierInvalid
	}
	input.StoreID = strings.TrimSpace(storeID)
	return postgres.CreateCatalogModifierGroup(ctx, s.db, input)
}

func (s *Service) CreateModifierOption(ctx context.Context, accessToken, storeID string, input postgres.CatalogModifierOptionInput) (postgres.CatalogModifierOptionRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogModifierOptionRecord{}, err
	}
	input.NameAr = strings.Join(strings.Fields(strings.TrimSpace(input.NameAr)), " ")
	if input.NameAr == "" || input.PriceDeltaMinor < 0 || input.Ordinal < 0 || input.Ordinal > 1000 {
		return postgres.CatalogModifierOptionRecord{}, ErrCatalogModifierInvalid
	}
	var ownerStore string
	if err := s.db.QueryRowContext(ctx, "SELECT g.store_id FROM dsh.catalog_modifier_groups g WHERE g.id=$1", input.GroupID).Scan(&ownerStore); err != nil {
		return postgres.CatalogModifierOptionRecord{}, err
	}
	if ownerStore != strings.TrimSpace(storeID) {
		return postgres.CatalogModifierOptionRecord{}, ErrStoreOwnershipForbidden
	}
	return postgres.CreateCatalogModifierOption(ctx, s.db, input)
}

func (s *Service) AttachModifierGroup(ctx context.Context, accessToken, storeID, offerID, groupID string, ordinal int) error {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return err
	}
	if ordinal < 0 || ordinal > 1000 {
		return ErrCatalogModifierInvalid
	}
	return postgres.AttachCatalogModifierGroup(ctx, s.db, offerID, groupID, ordinal)
}

func (s *Service) ReadModifierGroup(ctx context.Context, accessToken, storeID, groupID string) (postgres.CatalogModifierGroupRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogModifierGroupRecord{}, err
	}
	item, err := postgres.ReadCatalogModifierGroup(ctx, s.db, strings.TrimSpace(groupID))
	if err != nil {
		return postgres.CatalogModifierGroupRecord{}, err
	}
	if item.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogModifierGroupRecord{}, ErrStoreOwnershipForbidden
	}
	return item, nil
}

func (s *Service) CreateStorefrontSection(ctx context.Context, accessToken, storeID string, input postgres.CatalogStorefrontSectionInput) (postgres.CatalogStorefrontSectionRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogStorefrontSectionRecord{}, err
	}
	input.NameAr = strings.Join(strings.Fields(strings.TrimSpace(input.NameAr)), " ")
	if input.NameAr == "" || input.Ordinal < 0 || input.Ordinal > 1000 {
		return postgres.CatalogStorefrontSectionRecord{}, ErrCatalogSectionInvalid
	}
	if input.NameEn != nil {
		value := strings.Join(strings.Fields(strings.TrimSpace(*input.NameEn)), " ")
		if value == "" {
			input.NameEn = nil
		} else {
			input.NameEn = &value
		}
	}
	input.StoreID = strings.TrimSpace(storeID)
	return postgres.CreateCatalogStorefrontSection(ctx, s.db, input)
}

func (s *Service) AttachOfferToSection(ctx context.Context, accessToken, storeID, sectionID, offerID string, ordinal int) error {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return err
	}
	if ordinal < 0 || ordinal > 1000 {
		return ErrCatalogSectionInvalid
	}
	return postgres.AttachOfferToCatalogStorefrontSection(ctx, s.db, sectionID, offerID, ordinal)
}

func (s *Service) ReadStorefrontSection(ctx context.Context, accessToken, storeID, sectionID string) (postgres.CatalogStorefrontSectionRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogStorefrontSectionRecord{}, err
	}
	item, err := postgres.ReadCatalogStorefrontSection(ctx, s.db, strings.TrimSpace(sectionID))
	if err != nil {
		return postgres.CatalogStorefrontSectionRecord{}, err
	}
	if item.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogStorefrontSectionRecord{}, ErrStoreOwnershipForbidden
	}
	return item, nil
}

func (s *Service) ValidateCurrentCatalog(ctx context.Context, storeID string) error {
	ready, err := postgres.HasPublishableCatalog(ctx, s.db, storeID)
	if err != nil {
		return err
	}
	if !ready {
		return errors.New("catalog is not customer-visible")
	}
	return nil
}
