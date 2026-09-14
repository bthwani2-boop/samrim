package locationcore

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrClientSessionForbidden  = errors.New("an active app-client session is required")
	ErrPartnerSessionForbidden = errors.New("an active app-partner session is required")
	ErrStoreOwnershipForbidden = errors.New("partner store ownership is required")
	ErrLocationInputInvalid    = errors.New("location input is invalid")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identityClient *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identityClient == nil {
		return nil, errors.New("DSH Identity client is nil")
	}
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	return &Service{identity: identityClient, db: db}, nil
}

func (s *Service) ListOwnAddresses(ctx context.Context, accessToken string, limit int, cursor string) (postgres.DeliveryAddressListResult, error) {
	actorID, err := s.requireClientSession(ctx, accessToken)
	if err != nil {
		return postgres.DeliveryAddressListResult{}, err
	}
	return postgres.ListDeliveryAddresses(ctx, s.db, actorID, limit, cursor)
}

func (s *Service) ReadOwnAddress(ctx context.Context, accessToken, addressID string) (postgres.DeliveryAddressRecord, error) {
	actorID, err := s.requireClientSession(ctx, accessToken)
	if err != nil {
		return postgres.DeliveryAddressRecord{}, err
	}
	return postgres.ReadDeliveryAddress(ctx, s.db, addressID, actorID)
}

func (s *Service) CreateOwnAddress(ctx context.Context, accessToken, addressText string, latitude, longitude float64, idempotencyKey, correlationID string) (postgres.DeliveryAddressResult, error) {
	actorID, err := s.requireClientSession(ctx, accessToken)
	if err != nil {
		return postgres.DeliveryAddressResult{}, err
	}
	addressText = strings.TrimSpace(addressText)
	if addressText == "" {
		return postgres.DeliveryAddressResult{}, ErrLocationInputInvalid
	}
	return postgres.CreateDeliveryAddress(ctx, s.db, actorID, addressText, latitude, longitude, idempotencyKey, postgres.HashDeliveryAddressCreateRequest(actorID, addressText, latitude, longitude), correlationID)
}

func (s *Service) UpdateOwnAddress(ctx context.Context, accessToken, addressID, addressText string, latitude, longitude float64, expectedVersion int, idempotencyKey, correlationID string) (postgres.DeliveryAddressResult, error) {
	actorID, err := s.requireClientSession(ctx, accessToken)
	if err != nil {
		return postgres.DeliveryAddressResult{}, err
	}
	addressID = strings.TrimSpace(addressID)
	addressText = strings.TrimSpace(addressText)
	if addressID == "" || addressText == "" {
		return postgres.DeliveryAddressResult{}, ErrLocationInputInvalid
	}
	return postgres.UpdateDeliveryAddress(ctx, s.db, addressID, actorID, addressText, latitude, longitude, expectedVersion, idempotencyKey, postgres.HashDeliveryAddressUpdateRequest(addressID, actorID, addressText, latitude, longitude, expectedVersion), correlationID)
}

func (s *Service) ReadStoreOrigin(ctx context.Context, accessToken, storeID string) (postgres.StoreDeliveryOriginRecord, bool, error) {
	partnerActorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.StoreDeliveryOriginRecord{}, false, err
	}
	return postgres.ReadStoreDeliveryOrigin(ctx, s.db, storeID, partnerActorID)
}

func (s *Service) SetStoreOrigin(ctx context.Context, accessToken, storeID string, latitude, longitude float64, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreDeliveryOriginResult, error) {
	partnerActorID, err := s.requireStoreOwner(ctx, accessToken, storeID)
	if err != nil {
		return postgres.StoreDeliveryOriginResult{}, err
	}
	storeID = strings.TrimSpace(storeID)
	return postgres.SetStoreDeliveryOrigin(ctx, s.db, storeID, partnerActorID, latitude, longitude, expectedVersion, idempotencyKey, postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, latitude, longitude, expectedVersion), correlationID)
}

func (s *Service) requireClientSession(ctx context.Context, accessToken string) (string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", err
	}
	if identity.Role != "client" || identity.Surface != "app-client" || strings.TrimSpace(identity.Subject) == "" {
		return "", ErrClientSessionForbidden
	}
	return identity.Subject, nil
}

func (s *Service) requireStoreOwner(ctx context.Context, accessToken, storeID string) (string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return "", ErrPartnerSessionForbidden
	}
	_, err = postgres.ReadStoreOwnedByPartner(ctx, s.db, storeID, identity.Subject)
	if errors.Is(err, postgres.ErrStoreNotFound) {
		return "", postgres.ErrStoreOriginNotFound
	}
	if err != nil {
		return "", err
	}
	return identity.Subject, nil
}
