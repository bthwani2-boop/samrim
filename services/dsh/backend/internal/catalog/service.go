package catalog

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrPartnerSessionForbidden = errors.New("an active app-partner session is required")
	ErrStoreOwnershipForbidden = errors.New("partner does not own this store")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("catalog configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) ListForPartner(ctx context.Context, accessToken, storeID string) ([]postgres.CatalogItemRecord, error) {
	if _, err := s.requireStoreOwner(ctx, accessToken, storeID); err != nil {
		return nil, err
	}
	return postgres.ListCatalogItems(ctx, s.db, storeID, false)
}

func (s *Service) Create(ctx context.Context, accessToken, storeID, name, idempotencyKey, correlationID string) (postgres.CatalogItemResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogItemResult{}, err
	}
	name = strings.TrimSpace(name)
	if len(name) < 1 || len(name) > 160 {
		return postgres.CatalogItemResult{}, errors.New("catalog item name is invalid")
	}
	return postgres.CreateCatalogItem(ctx, s.db, storeID, name, strings.TrimSpace(idempotencyKey), postgres.HashCatalogCreateRequest(storeID, name), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) Update(ctx context.Context, accessToken, storeID, itemID, name, state string, availability bool, expectedVersion int, idempotencyKey, correlationID string) (postgres.CatalogItemResult, error) {
	actorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.CatalogItemResult{}, err
	}
	name = strings.TrimSpace(name)
	state = strings.ToLower(strings.TrimSpace(state))
	if len(name) < 1 || len(name) > 160 || expectedVersion < 1 {
		return postgres.CatalogItemResult{}, errors.New("catalog item facts are invalid")
	}
	return postgres.UpdateCatalogItem(ctx, s.db, storeID, itemID, name, state, availability, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCatalogUpdateRequest(storeID, itemID, name, state, availability, expectedVersion), actorID, strings.TrimSpace(correlationID))
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
