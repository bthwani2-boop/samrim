package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListOffersForPartner(ctx context.Context, accessToken, storeID string) ([]postgres.CatalogStoreOfferRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return nil, err
	}
	return postgres.ListCatalogOffers(ctx, s.db, strings.TrimSpace(storeID), false)
}

func (s *Service) CreateStoreOffer(ctx context.Context, accessToken, storeID, variantID string, priceMinor int64, quantityPolicy, pricingBasis, idempotencyKey, correlationID string) (postgres.CatalogStoreOfferResult, error) {
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
	return postgres.CreateCatalogOffer(ctx, s.db, storeID, variantID, priceMinor, quantityPolicy, pricingBasis, strings.TrimSpace(idempotencyKey), postgres.HashCatalogOfferCreateRequest(storeID, variantID, priceMinor, quantityPolicy, pricingBasis), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateStoreOffer(ctx context.Context, accessToken, storeID, offerID string, priceMinor int64, availability bool, publicationState string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogStoreOfferResult, error) {
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
	return postgres.UpdateCatalogOffer(ctx, s.db, offerID, priceMinor, availability, strings.ToLower(strings.TrimSpace(publicationState)), expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogOfferUpdateRequest(offerID, priceMinor, availability, publicationState, expectedVersion), actorID, strings.TrimSpace(correlationID))
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
