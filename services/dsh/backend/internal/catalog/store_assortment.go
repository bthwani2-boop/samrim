package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListForPartner(ctx context.Context, accessToken, storeID string) ([]postgres.StoreAssortmentRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return nil, err
	}
	return postgres.ListStoreAssortments(ctx, s.db, strings.TrimSpace(storeID), false)
}

func (s *Service) CreateStoreAssortment(ctx context.Context, accessToken, storeID, productID string, priceMinor int64, idempotencyKey, correlationID string) (postgres.StoreAssortmentResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.StoreAssortmentResult{}, err
	}
	storeID = strings.TrimSpace(storeID)
	productID = strings.TrimSpace(productID)
	if storeID == "" || productID == "" || priceMinor <= 0 {
		return postgres.StoreAssortmentResult{}, errors.New("Store Assortment facts are invalid")
	}
	return postgres.CreateStoreAssortment(ctx, s.db, storeID, productID, priceMinor, strings.TrimSpace(idempotencyKey), postgres.HashStoreAssortmentCreateRequest(storeID, productID, priceMinor), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateStoreAssortment(ctx context.Context, accessToken, storeID, productID string, priceMinor int64, availability bool, publicationState string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreAssortmentResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.StoreAssortmentResult{}, err
	}
	storeID = strings.TrimSpace(storeID)
	productID = strings.TrimSpace(productID)
	publicationState = strings.ToLower(strings.TrimSpace(publicationState))
	if storeID == "" || productID == "" || priceMinor <= 0 || expectedVersion < 1 {
		return postgres.StoreAssortmentResult{}, errors.New("Store Assortment facts are invalid")
	}
	return postgres.UpdateStoreAssortment(ctx, s.db, storeID, productID, priceMinor, availability, publicationState, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashStoreAssortmentUpdateRequest(storeID, productID, priceMinor, availability, publicationState, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) requirePartnerSession(ctx context.Context, accessToken string) error {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return ErrPartnerSessionForbidden
	}
	return nil
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
