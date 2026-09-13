package storepublication

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrOperatorNotActive             = errors.New("operator actor is not active")
	ErrPublicationReadinessBlocked   = errors.New("store publication readiness is blocked")
	ErrPartnerIdentityUnavailable    = errors.New("partner Identity eligibility is unavailable")
	PartnerIdentityNotEligibleReason = "PARTNER_IDENTITY_NOT_ELIGIBLE"
)

type PublicationReadiness struct {
	Ready         bool
	BlockedReason string
}

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

func (s *Service) Publish(ctx context.Context, storeID, requestedState string, expectedVersion int, idempotencyKey, actingActorID, correlationID string) (postgres.PublicationResult, PublicationReadiness, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.PublicationResult{}, PublicationReadiness{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.PublicationResult{}, PublicationReadiness{}, ErrOperatorNotActive
	}
	requestHash := postgres.HashStorePublicationRequest(storeID, requestedState, expectedVersion)
	var readiness PublicationReadiness
	result, err := postgres.SetStorePublicationWithGuard(ctx, s.db, storeID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, func(guardCtx context.Context, store postgres.StoreRecord) error {
		current, readinessErr := s.ReadinessForStore(guardCtx, store)
		readiness = current
		if readinessErr != nil {
			return readinessErr
		}
		if requestedState == "published" && !current.Ready {
			return ErrPublicationReadinessBlocked
		}
		return nil
	})
	if err != nil {
		return postgres.PublicationResult{}, readiness, err
	}
	if result.Replayed {
		readiness, err = s.ReadinessForStore(ctx, result.Store)
		if err != nil {
			return postgres.PublicationResult{}, PublicationReadiness{}, err
		}
	}
	return result, readiness, nil
}

func (s *Service) ReadForOperator(ctx context.Context, storeID, actingActorID string) (postgres.StoreRecord, PublicationReadiness, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	operator, err := s.identity.ReadActorRole(ctx, actingActorID, "operator")
	if err != nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, ErrOperatorNotActive
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return postgres.StoreRecord{}, PublicationReadiness{}, err
	}
	readiness, err := s.ReadinessForStore(ctx, store)
	return store, readiness, err
}

func (s *Service) ListPublished(ctx context.Context) ([]postgres.PublicStoreRecord, error) {
	stores, err := postgres.ListPublishedStores(ctx, s.db)
	if err != nil {
		return nil, err
	}
	visible := make([]postgres.PublicStoreRecord, 0, len(stores))
	for _, store := range stores {
		readiness, readinessErr := s.ReadinessForPartner(ctx, store.PartnerActorID)
		if readinessErr != nil {
			return nil, readinessErr
		}
		if readiness.Ready {
			visible = append(visible, store)
		}
	}
	return visible, nil
}

func (s *Service) ReadPublished(ctx context.Context, storeID string) (postgres.PublicStoreRecord, error) {
	store, err := postgres.ReadPublishedStore(ctx, s.db, storeID)
	if err != nil {
		return postgres.PublicStoreRecord{}, err
	}
	readiness, err := s.ReadinessForPartner(ctx, store.PartnerActorID)
	if err != nil {
		return postgres.PublicStoreRecord{}, err
	}
	if !readiness.Ready {
		return postgres.PublicStoreRecord{}, postgres.ErrStoreNotFound
	}
	return store, nil
}

func (s *Service) ReadinessForStore(ctx context.Context, store postgres.StoreRecord) (PublicationReadiness, error) {
	return s.ReadinessForPartner(ctx, store.PartnerActorID)
}

func (s *Service) ReadinessForPartner(ctx context.Context, partnerActorID string) (PublicationReadiness, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	if partnerActorID == "" {
		return blockedReadiness(), nil
	}
	partner, err := s.identity.ReadActorRole(ctx, partnerActorID, "partner")
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) && identityErr.Status == 404 {
			return blockedReadiness(), nil
		}
		return PublicationReadiness{}, fmt.Errorf("%w: %w", ErrPartnerIdentityUnavailable, err)
	}
	return evaluatePartnerReadiness(partner), nil
}

func blockedReadiness() PublicationReadiness {
	return PublicationReadiness{BlockedReason: PartnerIdentityNotEligibleReason}
}

func evaluatePartnerReadiness(partner identityclient.ActorRoleView) PublicationReadiness {
	if partner.Role != "partner" || !partner.Enabled || !partner.SecurityEnabled || partner.ActivatedAt == nil {
		return blockedReadiness()
	}
	return PublicationReadiness{Ready: true}
}
