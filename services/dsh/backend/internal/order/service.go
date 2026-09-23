package order

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrClientSessionForbidden       = errors.New("an active app-client session is required")
	ErrPartnerSessionForbidden      = errors.New("an active app-partner session is required")
	ErrConversationSessionForbidden = errors.New("an active order conversation session is required")
	ErrStoreOwnershipForbidden      = errors.New("partner does not own this Store")
	ErrOperatorNotActive            = errors.New("operator is not active")
	ErrPaymentUnavailable           = errors.New("payment operation is unavailable")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	payment  *wlt.Client
}

func New(identity *identityintegration.Client, db *sql.DB, payment *wlt.Client) (*Service, error) {
	if identity == nil || db == nil || payment == nil {
		return nil, errors.New("order configuration is invalid")
	}
	return &Service{identity: identity, db: db, payment: payment}, nil
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

func (s *Service) ReadTracking(ctx context.Context, accessToken, orderID string) (postgres.ClientOrderTracking, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return postgres.ClientOrderTracking{}, err
	}
	return postgres.ReadClientOrderTracking(ctx, s.db, orderID, identity)
}

func (s *Service) ReadClientDeliveryProof(ctx context.Context, accessToken, orderID string) (postgres.DeliveryProofRecord, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return postgres.DeliveryProofRecord{}, err
	}
	return postgres.ReadClientDeliveryProof(ctx, s.db, orderID, identity)
}

func (s *Service) ReadClientOrderRating(ctx context.Context, accessToken, orderID string) (postgres.OrderRatingRecord, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return postgres.OrderRatingRecord{}, err
	}
	return postgres.ReadClientOrderRating(ctx, s.db, orderID, identity)
}

func (s *Service) CreateClientOrderRating(ctx context.Context, accessToken, orderID string, rating int, review string, expectedVersion int, idempotencyKey, correlationID string) (postgres.OrderRatingRecord, bool, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return postgres.OrderRatingRecord{}, false, err
	}
	requestHash := postgres.HashOrderRatingRequest(orderID, rating, review, expectedVersion)
	return postgres.CreateClientOrderRating(ctx, s.db, orderID, identity, rating, review, expectedVersion, idempotencyKey, requestHash, correlationID)
}

func (s *Service) ReadOrderConversation(ctx context.Context, accessToken, orderID string, limit int) (postgres.OrderConversationRecord, error) {
	actorID, role, err := s.requireConversationSession(ctx, accessToken)
	if err != nil {
		return postgres.OrderConversationRecord{}, err
	}
	conversation, err := postgres.ReadOrderConversation(ctx, s.db, orderID, actorID, role, limit)
	if err != nil {
		return postgres.OrderConversationRecord{}, err
	}
	conversation.OrderID = strings.TrimSpace(orderID)
	return conversation, nil
}

func (s *Service) SendOrderConversationMessage(ctx context.Context, accessToken, orderID, body, idempotencyKey, correlationID string) (postgres.OrderConversationMessageRecord, bool, error) {
	actorID, role, err := s.requireConversationSession(ctx, accessToken)
	if err != nil {
		return postgres.OrderConversationMessageRecord{}, false, err
	}
	requestHash := postgres.HashOrderConversationMessageRequest(orderID, body)
	return postgres.SendOrderConversationMessage(ctx, s.db, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID)
}

func (s *Service) MarkOrderConversationRead(ctx context.Context, accessToken, orderID, messageID string) (time.Time, error) {
	actorID, role, err := s.requireConversationSession(ctx, accessToken)
	if err != nil {
		return time.Time{}, err
	}
	return postgres.MarkOrderConversationRead(ctx, s.db, orderID, actorID, role, messageID)
}

func (s *Service) ListForClient(ctx context.Context, accessToken string, limit int) ([]postgres.OrderRecord, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return nil, err
	}
	return postgres.ListOrdersForClient(ctx, s.db, identity, "", limit)
}

func (s *Service) CancelForClient(ctx context.Context, accessToken, orderID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.OrderRecord, bool, error) {
	identity, err := s.requireSession(ctx, accessToken, "client", "app-client")
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	if expectedVersion < 1 || strings.TrimSpace(orderID) == "" {
		return postgres.OrderRecord{}, false, postgres.ErrOrderTransitionInvalid
	}
	if _, err := postgres.ReadOrderForClient(ctx, s.db, orderID, identity); err != nil {
		return postgres.OrderRecord{}, false, err
	}
	return postgres.TransitionOrderWithPaymentCancellation(ctx, s.db, orderID, "CANCELLED", expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashOrderTransition(orderID, "CANCELLED", expectedVersion), identity, strings.TrimSpace(correlationID), "client_cancelled")
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

func (s *Service) ListCashCustodyForOperator(ctx context.Context, actingActorID string) (wlt.CashLiabilityResponse, error) {
	if err := s.requireOperator(ctx, actingActorID); err != nil {
		return wlt.CashLiabilityResponse{}, err
	}
	return s.payment.ListOperatorCashLiability(ctx)
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
	state = strings.TrimSpace(state)
	if state == "CANCELLED" {
		return postgres.TransitionOrderWithPaymentCancellation(ctx, s.db, orderID, state, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashOrderTransition(orderID, state, expectedVersion), identity, strings.TrimSpace(correlationID), postgres.CancellationReasonPickupCustomerNoShow)
	}
	if state == "REJECTED" {
		return postgres.TransitionOrderWithPaymentCancellation(ctx, s.db, orderID, "REJECTED", expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashOrderTransition(orderID, state, expectedVersion), identity, strings.TrimSpace(correlationID), "partner_rejected")
	}
	return postgres.TransitionOrder(ctx, s.db, orderID, state, "", expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashOrderTransition(orderID, state, expectedVersion), identity, strings.TrimSpace(correlationID))
}

func (s *Service) CompleteStorePickupForPartner(ctx context.Context, accessToken, storeID, orderID, code string, expectedVersion int, idempotencyKey, correlationID string) (postgres.OrderRecord, bool, error) {
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
	return postgres.CompleteStorePickup(ctx, s.db, orderID, code, expectedVersion, strings.TrimSpace(idempotencyKey), identity, strings.TrimSpace(correlationID))
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

func (s *Service) requireConversationSession(ctx context.Context, accessToken string) (string, string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", "", err
	}
	role := string(identity.Role)
	surface := identity.Surface
	if strings.TrimSpace(identity.Subject) == "" || (role != "client" && role != "partner" && role != "captain") || surface != "app-"+role {
		return "", "", ErrConversationSessionForbidden
	}
	return strings.TrimSpace(identity.Subject), role, nil
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
