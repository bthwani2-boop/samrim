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

func (s *Service) ListQuickPricesForPartner(ctx context.Context, accessToken, storeID string, filters postgres.CatalogQuickPriceFilters, limit int, cursor string) (postgres.CatalogStoreOfferPage, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return postgres.CatalogStoreOfferPage{}, err
	}
	return postgres.ListCatalogQuickPriceOffers(ctx, s.db, strings.TrimSpace(storeID), filters, limit, cursor)
}

func (s *Service) UpdateQuickPricesForPartner(ctx context.Context, accessToken, storeID string, changes []postgres.CatalogQuickPriceUpdateInput, idempotencyKey, correlationID string) ([]postgres.CatalogQuickPriceUpdateResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return nil, err
	}
	return s.applyQuickPrices(ctx, actorID, strings.TrimSpace(storeID), changes, idempotencyKey, correlationID)
}

func (s *Service) applyQuickPrices(ctx context.Context, actorID, storeID string, changes []postgres.CatalogQuickPriceUpdateInput, idempotencyKey, correlationID string) ([]postgres.CatalogQuickPriceUpdateResult, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	correlationID = strings.TrimSpace(correlationID)
	if err := validateQuickPriceRequest(storeID, idempotencyKey, correlationID, changes); err != nil {
		return nil, err
	}
	results := make([]postgres.CatalogQuickPriceUpdateResult, 0, len(changes))
	for _, change := range changes {
		result, err := s.applyQuickPriceChange(ctx, actorID, storeID, change, idempotencyKey, correlationID)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, nil
}

func validateQuickPriceRequest(storeID, idempotencyKey, correlationID string, changes []postgres.CatalogQuickPriceUpdateInput) error {
	if storeID == "" || idempotencyKey == "" || correlationID == "" || len(changes) < 1 || len(changes) > 100 {
		return postgres.ErrCatalogQuickPriceInvalidFilter
	}
	seen := make(map[string]struct{}, len(changes))
	for _, change := range changes {
		offerID := strings.TrimSpace(change.OfferID)
		if offerID == "" || change.ExpectedVersion < 1 || change.PriceMinor < 1 {
			return postgres.ErrCatalogQuickPriceInvalidFilter
		}
		if _, exists := seen[offerID]; exists {
			return postgres.ErrCatalogQuickPriceInvalidFilter
		}
		seen[offerID] = struct{}{}
	}
	return nil
}

func (s *Service) applyQuickPriceChange(ctx context.Context, actorID, storeID string, change postgres.CatalogQuickPriceUpdateInput, idempotencyKey, correlationID string) (postgres.CatalogQuickPriceUpdateResult, error) {
	offerID := strings.TrimSpace(change.OfferID)
	current, readErr := postgres.ReadCatalogOffer(ctx, s.db, offerID)
	if readErr != nil {
		return postgres.CatalogQuickPriceUpdateResult{}, readErr
	}
	if current.StoreID != storeID {
		return postgres.CatalogQuickPriceUpdateResult{}, ErrStoreOwnershipForbidden
	}
	if change.PriceMinor == current.PriceMinor {
		return postgres.CatalogQuickPriceUpdateResult{OfferID: offerID, Outcome: "UNCHANGED", Offer: &current}, nil
	}
	update := postgres.CatalogOfferUpdateInput{PriceMinor: change.PriceMinor, Availability: current.Availability, PublicationState: current.PublicationState, QuantityPolicy: current.QuantityPolicy, QuantityMinBaseUnits: quickPriceQuantity(current.QuantityMinBaseUnits), QuantityMaxBaseUnits: quickPriceQuantity(current.QuantityMaxBaseUnits), QuantityStepBaseUnits: quickPriceQuantity(current.QuantityStepBaseUnits), PricingBasis: current.PricingBasis, PricingUnitBaseUnits: current.PricingUnitBaseUnits, InventoryPolicy: current.InventoryPolicy, InventoryOnHandBaseUnits: current.InventoryOnHandBaseUnits}
	itemKey := "quick-price-" + postgres.HashCatalogQuickPriceItemKey(idempotencyKey, storeID, offerID)[:48]
	updated, updateErr := postgres.UpdateCatalogOfferWithProvenance(ctx, s.db, offerID, update, change.ExpectedVersion, itemKey, postgres.HashCatalogQuickPriceUpdateRequest(offerID, change.PriceMinor, change.ExpectedVersion), actorID, correlationID, "QUICK_PRICES")
	if errors.Is(updateErr, postgres.ErrCatalogVersionConflict) {
		current, readErr = postgres.ReadCatalogOffer(ctx, s.db, offerID)
		if readErr != nil {
			return postgres.CatalogQuickPriceUpdateResult{}, readErr
		}
		return postgres.CatalogQuickPriceUpdateResult{OfferID: offerID, Outcome: "VERSION_CONFLICT", Offer: &current}, nil
	}
	if updateErr != nil {
		return postgres.CatalogQuickPriceUpdateResult{}, updateErr
	}
	outcome := "UPDATED"
	if updated.Replayed {
		outcome = "REPLAYED"
	}
	offer := updated.Offer
	return postgres.CatalogQuickPriceUpdateResult{OfferID: offerID, Outcome: outcome, Offer: &offer}, nil
}

func quickPriceQuantity(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
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
	if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, s.db, storeID, identity.Subject, "catalog"); err != nil {
		if errors.Is(err, postgres.ErrStoreAccessForbidden) {
			return "", ErrStoreOwnershipForbidden
		}
		return "", err
	}
	return identity.Subject, nil
}
