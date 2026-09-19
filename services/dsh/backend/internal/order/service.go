package order

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
	ErrStoreOwnershipForbidden = errors.New("partner does not own this Store")
	ErrOperatorNotActive       = errors.New("operator is not active")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("order configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) Read(ctx context.Context, accessToken, orderID string) (postgres.OrderRecord, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return postgres.OrderRecord{}, err
	}
	switch string(identity.Role) {
	case "client":
		if identity.Surface != "app-client" || strings.TrimSpace(identity.Subject) == "" {
			return postgres.OrderRecord{}, ErrClientSessionForbidden
		}
		return postgres.ReadOrderForClient(ctx, s.db, orderID, identity.Subject)
	case "partner":
		if identity.Surface != "app-partner" || strings.TrimSpace(identity.Subject) == "" {
			return postgres.OrderRecord{}, ErrPartnerSessionForbidden
		}
		order, err := postgres.ReadOrder(ctx, s.db, orderID)
		if err != nil {
			return postgres.OrderRecord{}, err
		}
		if err := s.requireOwnedStore(ctx, identity.Subject, order.StoreID); err != nil {
			return postgres.OrderRecord{}, err
		}
		return order, nil
	default:
		return postgres.OrderRecord{}, ErrClientSessionForbidden
	}
}

func (s *Service) ListForClient(ctx context.Context, accessToken string, limit int) ([]postgres.OrderRecord, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return nil, err
	}
	return postgres.ListOrdersForClient(ctx, s.db, identity, "", limit)
}

func (s *Service) ListForPartner(ctx context.Context, accessToken, storeID string, limit int) ([]postgres.OrderRecord, error) {
	identity, err := s.requireSession(ctx, accessToken, "partner", "app-partner")
	if err != nil {
		return nil, err
	}
	if err := s.requireOwnedStore(ctx, identity, storeID); err != nil {
		return nil, err
	}
	return postgres.ListOrdersForStore(ctx, s.db, strings.TrimSpace(storeID), "", limit)
}

func (s *Service) ListForOperator(ctx context.Context, state, actingActorID string, limit int, cursor string) (postgres.OperatorOperationsResult, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.OperatorOperationsResult{}, err
	}
	return postgres.ListOrdersForOperator(ctx, s.db, state, limit, cursor)
}

func (s *Service) ReadForOperator(ctx context.Context, orderID, actingActorID string) (postgres.OperatorOperationRecord, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return postgres.OperatorOperationRecord{}, err
	}
	return postgres.ReadOperatorOperation(ctx, s.db, orderID)
}

func (s *Service) TransitionForPartner(ctx context.Context, accessToken, storeID, orderID, state string, expectedVersion int, idempotencyKey, correlationID string) (postgres.OrderRecord, bool, error) {
	identity, err := s.requireSession(ctx, accessToken, "partner", "app-partner")
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	if err := s.requireOwnedStore(ctx, identity, storeID); err != nil {
		return postgres.OrderRecord{}, false, err
	}
	current, err := postgres.ReadOrder(ctx, s.db, orderID)
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	if current.StoreID != strings.TrimSpace(storeID) {
		return postgres.OrderRecord{}, false, ErrStoreOwnershipForbidden
	}
	return postgres.TransitionOrder(ctx, s.db, orderID, strings.TrimSpace(state), expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashOrderTransition(orderID, state, expectedVersion), identity, strings.TrimSpace(correlationID))
}

func (s *Service) requireSession(ctx context.Context, accessToken, role, surface string) (string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", err
	}
	if string(identity.Role) != role || identity.Surface != surface || strings.TrimSpace(identity.Subject) == "" {
		if role == "partner" {
			return "", ErrPartnerSessionForbidden
		}
		return "", ErrClientSessionForbidden
	}
	return identity.Subject, nil
}

func (s *Service) requireOwnedStore(ctx context.Context, partnerActorID, storeID string) error {
	_, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID))
	if errors.Is(err, postgres.ErrStoreNotFound) {
		return ErrStoreOwnershipForbidden
	}
	return err
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
