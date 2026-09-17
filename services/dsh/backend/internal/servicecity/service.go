package servicecity

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrOperatorNotActive = errors.New("operator actor is not active")
	ErrInvalidInput      = errors.New("service city input is invalid")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identityClient *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identityClient == nil || db == nil {
		return nil, errors.New("service city configuration is invalid")
	}
	return &Service{identity: identityClient, db: db}, nil
}

func (s *Service) List(ctx context.Context, includeInactive bool, actingActorID string) ([]postgres.ServiceCityRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	if includeInactive {
		return postgres.ListServiceCities(ctx, s.db)
	}
	return postgres.ListActiveServiceCities(ctx, s.db)
}

func (s *Service) Create(ctx context.Context, displayNameAr string, active bool, idempotencyKey, actingActorID, correlationID string) (postgres.ServiceCityResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.ServiceCityResult{}, err
	}
	if strings.TrimSpace(displayNameAr) == "" {
		return postgres.ServiceCityResult{}, ErrInvalidInput
	}
	return postgres.CreateServiceCity(ctx, s.db, displayNameAr, active, idempotencyKey, postgres.HashServiceCityCreateRequest(displayNameAr, active), actingActorID, correlationID)
}

func (s *Service) Update(ctx context.Context, cityID, displayNameAr string, active bool, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.ServiceCityResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.ServiceCityResult{}, err
	}
	if strings.TrimSpace(cityID) == "" || strings.TrimSpace(displayNameAr) == "" || expectedVersion < 1 {
		return postgres.ServiceCityResult{}, ErrInvalidInput
	}
	return postgres.UpdateServiceCity(ctx, s.db, cityID, displayNameAr, active, expectedVersion, idempotencyKey, postgres.HashServiceCityUpdateRequest(cityID, displayNameAr, active, expectedVersion), actingActorID, correlationID)
}

func (s *Service) Read(ctx context.Context, cityID, actingActorID string) (postgres.ServiceCityRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.ServiceCityRecord{}, err
	}
	return postgres.ReadServiceCity(ctx, s.db, cityID)
}

func (s *Service) requireOperator(ctx context.Context, actorID string) error {
	operator, err := s.identity.ReadActorRole(ctx, strings.TrimSpace(actorID), "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return ErrOperatorNotActive
	}
	return nil
}
