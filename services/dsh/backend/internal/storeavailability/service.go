package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrInvalidInput            = errors.New("Store operational availability input is invalid")
	ErrPartnerSessionForbidden = errors.New("an active app-partner session is required")
	ErrStoreAccessForbidden    = errors.New("Partner is not authorized to manage Store operations")
	ErrOperatorNotActive       = errors.New("operator is not active")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("Store operational availability configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) Read(ctx context.Context, storeID string) (postgres.StoreOperationalAvailability, error) {
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return postgres.StoreOperationalAvailability{}, ErrInvalidInput
	}
	return postgres.ReadStoreOperationalAvailability(ctx, s.db, storeID)
}

func (s *Service) Evaluate(ctx context.Context, storeID, fulfillmentMode string, at time.Time) (postgres.StoreOrderability, error) {
	storeID, fulfillmentMode = strings.TrimSpace(storeID), strings.TrimSpace(fulfillmentMode)
	if storeID == "" || fulfillmentMode == "" {
		return postgres.StoreOrderability{}, ErrInvalidInput
	}
	return postgres.EvaluateStoreOrderability(ctx, s.db, storeID, fulfillmentMode, at)
}

func (s *Service) UpdateForPartner(ctx context.Context, accessToken string, input postgres.UpdateStoreOperationalAvailabilityInput) (postgres.StoreOperationalAvailability, bool, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.StoreOperationalAvailability{}, false, err
	}
	input.StoreID = strings.TrimSpace(input.StoreID)
	if input.StoreID == "" {
		return postgres.StoreOperationalAvailability{}, false, ErrInvalidInput
	}
	_, authority, err := postgres.AuthorizePartnerStoreAction(ctx, s.db, input.StoreID, identity.Subject, "store_operations")
	if err != nil {
		if errors.Is(err, postgres.ErrStoreAccessForbidden) || errors.Is(err, postgres.ErrStoreNotFound) {
			return postgres.StoreOperationalAvailability{}, false, ErrStoreAccessForbidden
		}
		return postgres.StoreOperationalAvailability{}, false, err
	}
	input.ActingActorID = identity.Subject
	input.AuthoritySource = authority
	return postgres.UpdateStoreOperationalAvailability(ctx, s.db, input)
}

func (s *Service) UpdateForOperator(ctx context.Context, actingActorID string, input postgres.UpdateStoreOperationalAvailabilityInput) (postgres.StoreOperationalAvailability, bool, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	if actingActorID == "" || strings.TrimSpace(input.StoreID) == "" {
		return postgres.StoreOperationalAvailability{}, false, ErrInvalidInput
	}
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.StoreOperationalAvailability{}, false, err
	}
	if _, err := postgres.ReadStore(ctx, s.db, strings.TrimSpace(input.StoreID)); err != nil {
		return postgres.StoreOperationalAvailability{}, false, err
	}
	input.ActingActorID = actingActorID
	input.AuthoritySource = "OPERATOR"
	return postgres.UpdateStoreOperationalAvailability(ctx, s.db, input)
}

func (s *Service) requirePartner(ctx context.Context, accessToken string) (identityclient.ActorIdentity, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return identityclient.ActorIdentity{}, err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return identityclient.ActorIdentity{}, ErrPartnerSessionForbidden
	}
	return identity, nil
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return s.identity.RequireOperatorPermission(ctx, strings.TrimSpace(actorID), "operations")
}
