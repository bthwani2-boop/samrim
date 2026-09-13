package partnerbootstrap

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("partner bootstrap configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) Create(ctx context.Context, idempotencyKey, actingActorID, correlationID, partnerActorID, storeName string) (postgres.BootstrapRecord, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	storeName = strings.TrimSpace(storeName)
	if partnerActorID == "" || len(partnerActorID) > 128 || len(storeName) < 2 || len(storeName) > 160 {
		return postgres.BootstrapRecord{}, errors.New("partner actor and store name are invalid")
	}
	partner, err := s.identity.ReadActorRole(ctx, partnerActorID, "partner")
	if err != nil {
		return postgres.BootstrapRecord{}, err
	}
	if !partner.Enabled || !partner.SecurityEnabled || partner.ActivatedAt == nil {
		return postgres.BootstrapRecord{}, ErrPartnerNotActive
	}
	return postgres.CreatePartnerBootstrap(ctx, s.db, strings.TrimSpace(idempotencyKey), postgres.HashBootstrapRequest(partnerActorID, storeName), strings.TrimSpace(actingActorID), strings.TrimSpace(correlationID), partnerActorID, storeName)
}

func (s *Service) ReadForOperator(ctx context.Context, partnerActorID string) (postgres.BootstrapRecord, error) {
	return postgres.ReadPartnerBootstrap(ctx, s.db, strings.TrimSpace(partnerActorID))
}

func (s *Service) ReadForPartner(ctx context.Context, accessToken string) (postgres.BootstrapRecord, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return postgres.BootstrapRecord{}, err
	}
	if identity.Role != "partner" || identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
		return postgres.BootstrapRecord{}, ErrPartnerSessionForbidden
	}
	return postgres.ReadPartnerBootstrap(ctx, s.db, identity.Subject)
}

var (
	ErrPartnerNotActive        = errors.New("partner actor is not active")
	ErrPartnerSessionForbidden = errors.New("an active app-partner session is required")
)
