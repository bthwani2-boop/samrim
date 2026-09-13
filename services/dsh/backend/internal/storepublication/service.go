package storepublication

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var ErrOperatorNotActive = errors.New("operator actor is not active")

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("store publication configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) Publish(ctx context.Context, storeID, requestedState string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.PublicationResult, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.PublicationResult{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.PublicationResult{}, ErrOperatorNotActive
	}
	requestHash := postgres.HashStorePublicationRequest(storeID, requestedState, expectedVersion)
	return postgres.SetStorePublication(ctx, s.db, storeID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID)
}

func (s *Service) ReadForOperator(ctx context.Context, storeID, actingActorID string) (postgres.StoreRecord, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.StoreRecord{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.StoreRecord{}, ErrOperatorNotActive
	}
	return postgres.ReadStore(ctx, s.db, storeID)
}

func (s *Service) ListPublished(ctx context.Context) ([]postgres.PublicStoreRecord, error) {
	return postgres.ListPublishedStores(ctx, s.db)
}

func (s *Service) ReadPublished(ctx context.Context, storeID string) (postgres.PublicStoreRecord, error) {
	return postgres.ReadPublishedStore(ctx, s.db, storeID)
}
