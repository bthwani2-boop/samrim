package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListOffersForPartner(ctx context.Context, accessToken, storeID string, limit int, cursor string) (postgres.CatalogStoreOfferPage, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogStoreOfferPage{}, err
	}
	return postgres.ListCatalogOfferPage(ctx, s.db, strings.TrimSpace(storeID), limit, cursor)
}

func (s *Service) ReadOfferForPartner(ctx context.Context, accessToken, storeID, offerID string) (postgres.CatalogStoreOfferRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogStoreOfferRecord{}, err
	}
	item, err := postgres.ReadCatalogOffer(ctx, s.db, strings.TrimSpace(offerID))
	if err != nil {
		return postgres.CatalogStoreOfferRecord{}, err
	}
	if item.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogStoreOfferRecord{}, postgres.ErrCatalogProductOwnership
	}
	return item, nil
}

func (s *Service) CreateStoreOffer(ctx context.Context, accessToken, storeID, variantID string, priceMinor int64, quantityPolicy string, quantityMinBaseUnits, quantityMaxBaseUnits, quantityStepBaseUnits int64, pricingBasis string, pricingUnitBaseUnits int64, inventoryPolicy string, inventoryOnHandBaseUnits int64, idempotencyKey, correlationID string) (postgres.CatalogStoreOfferResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	storeID = strings.TrimSpace(storeID)
	variantID = strings.TrimSpace(variantID)
	quantityPolicy = strings.TrimSpace(quantityPolicy)
	pricingBasis = strings.TrimSpace(pricingBasis)
	if storeID == "" || variantID == "" || priceMinor <= 0 {
		return postgres.CatalogStoreOfferResult{}, errors.New("StoreOffer facts are invalid")
	}
	input := postgres.CatalogOfferInput{StoreID: storeID, VariantID: variantID, PriceMinor: priceMinor, QuantityPolicy: quantityPolicy, QuantityMinBaseUnits: quantityMinBaseUnits, QuantityMaxBaseUnits: quantityMaxBaseUnits, QuantityStepBaseUnits: quantityStepBaseUnits, PricingBasis: pricingBasis, PricingUnitBaseUnits: pricingUnitBaseUnits, InventoryPolicy: inventoryPolicy, InventoryOnHandBaseUnits: inventoryOnHandBaseUnits}
	requestHash := postgres.HashCatalogOfferCreateRequest(input)
	return postgres.CreateCatalogOffer(ctx, s.db, input, strings.TrimSpace(idempotencyKey), requestHash, actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateStoreOffer(ctx context.Context, accessToken, storeID, offerID string, priceMinor int64, availability bool, publicationState, quantityPolicy string, quantityMinBaseUnits, quantityMaxBaseUnits, quantityStepBaseUnits int64, pricingBasis string, pricingUnitBaseUnits int64, inventoryPolicy string, inventoryOnHandBaseUnits int64, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogStoreOfferResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	offerID = strings.TrimSpace(offerID)
	if storeID == "" || offerID == "" || priceMinor <= 0 || expectedVersion < 1 {
		return postgres.CatalogStoreOfferResult{}, errors.New("StoreOffer facts are invalid")
	}
	offer, err := postgres.ReadCatalogOffer(ctx, s.db, offerID)
	if err != nil {
		return postgres.CatalogStoreOfferResult{}, err
	}
	if offer.StoreID != strings.TrimSpace(storeID) {
		return postgres.CatalogStoreOfferResult{}, ErrStoreOwnershipForbidden
	}
	update := postgres.CatalogOfferUpdateInput{PriceMinor: priceMinor, Availability: availability, PublicationState: strings.ToLower(strings.TrimSpace(publicationState)), QuantityPolicy: quantityPolicy, QuantityMinBaseUnits: quantityMinBaseUnits, QuantityMaxBaseUnits: quantityMaxBaseUnits, QuantityStepBaseUnits: quantityStepBaseUnits, PricingBasis: pricingBasis, PricingUnitBaseUnits: pricingUnitBaseUnits, InventoryPolicy: inventoryPolicy, InventoryOnHandBaseUnits: inventoryOnHandBaseUnits}
	return postgres.UpdateCatalogOffer(ctx, s.db, offerID, update, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogOfferUpdateRequest(offerID, update, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) requireStoreOwner(ctx context.Context, accessToken, storeID string) (string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return "", ErrPartnerSessionForbidden
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return "", err
	}
	if store.PartnerActorID != identity.Subject {
		return "", ErrStoreOwnershipForbidden
	}
	return identity.Subject, nil
}
