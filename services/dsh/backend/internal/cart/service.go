package cart

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/serviceability"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrClientSessionForbidden = errors.New("an active app-client session is required")
	ErrCheckoutNotServiceable = errors.New("address is not serviceable for this Store")
)

type Service struct {
	identity       *identityintegration.Client
	db             *sql.DB
	serviceability *serviceability.Service
	payment        *wlt.Client
}

func New(identity *identityintegration.Client, db *sql.DB, serviceabilityService *serviceability.Service, payment *wlt.Client) (*Service, error) {
	if identity == nil || db == nil || serviceabilityService == nil || payment == nil {
		return nil, errors.New("cart configuration is invalid")
	}
	return &Service{identity: identity, db: db, serviceability: serviceabilityService, payment: payment}, nil
}

func (s *Service) Read(ctx context.Context, accessToken, storeID string) (postgres.CartRecord, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.CartRecord{}, err
	}
	return postgres.ReadOpenCart(ctx, s.db, actorID, strings.TrimSpace(storeID))
}

func (s *Service) UpsertLine(ctx context.Context, accessToken, storeID, offerID string, quantity int64, modifierIDs []string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CartRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.CartRecord{}, false, err
	}
	storeID = strings.TrimSpace(storeID)
	offerID = strings.TrimSpace(offerID)
	if storeID == "" || offerID == "" || quantity <= 0 || expectedVersion < 0 {
		return postgres.CartRecord{}, false, postgres.ErrCartQuantityInvalid
	}
	return postgres.UpsertCartLine(ctx, s.db, actorID, storeID, offerID, quantity, modifierIDs, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCartLineMutation("line_upsert", storeID, offerID, quantity, modifierIDs, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) UpdateLine(ctx context.Context, accessToken, lineID string, quantity int64, modifierIDs []string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CartRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.CartRecord{}, false, err
	}
	if quantity <= 0 {
		return postgres.CartRecord{}, false, postgres.ErrCartQuantityInvalid
	}
	storeID := ""
	lineID = strings.TrimSpace(lineID)
	if lineID == "" {
		return postgres.CartRecord{}, false, postgres.ErrCartNotFound
	}
	return postgres.UpdateCartLine(ctx, s.db, actorID, lineID, quantity, modifierIDs, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCartLineMutation("line_upsert", storeID, lineID, quantity, modifierIDs, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) RemoveLine(ctx context.Context, accessToken, lineID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.CartRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.CartRecord{}, false, err
	}
	lineID = strings.TrimSpace(lineID)
	if lineID == "" {
		return postgres.CartRecord{}, false, postgres.ErrCartNotFound
	}
	return postgres.RemoveCartLine(ctx, s.db, actorID, lineID, expectedVersion, strings.TrimSpace(idempotencyKey), postgres.HashCartLineMutation("line_remove", "", lineID, 0, nil, expectedVersion), actorID, strings.TrimSpace(correlationID))
}

func (s *Service) Checkout(ctx context.Context, accessToken, cartID, storeID, addressID string, expectedCartVersion int, idempotencyKey, correlationID string) (postgres.OrderRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	if strings.TrimSpace(cartID) == "" || strings.TrimSpace(storeID) == "" || strings.TrimSpace(addressID) == "" || expectedCartVersion < 1 {
		return postgres.OrderRecord{}, false, postgres.ErrCheckoutEvidenceStale
	}
	serviceabilityResult, err := s.serviceability.Evaluate(ctx, accessToken, storeID, addressID)
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	if serviceabilityResult.Status != "SERVICEABLE" {
		return postgres.OrderRecord{}, false, ErrCheckoutNotServiceable
	}
	facts := serviceabilityResult.Facts
	input := postgres.CheckoutInput{
		ClientActorID: actorID, CartID: strings.TrimSpace(cartID), StoreID: strings.TrimSpace(storeID), AddressID: strings.TrimSpace(addressID), ExpectedCartVersion: expectedCartVersion,
		Evidence:       postgres.CheckoutEvidence{ServiceCityID: facts.StoreServiceCityID, PolicyVersion: serviceability.PolicyVersion, Status: serviceabilityResult.Status, StoreVersion: facts.StoreVersion, AddressVersion: facts.AddressVersion},
		IdempotencyKey: strings.TrimSpace(idempotencyKey), ActingActorID: actorID, CorrelationID: strings.TrimSpace(correlationID),
		PaymentExternalReference: wlt.DerivedExternalReference("checkout", idempotencyKey),
		PaymentIdempotencyKey:    wlt.DerivedIdempotencyKey("create", idempotencyKey),
		PaymentCancellationKey:   wlt.DerivedIdempotencyKey("cancel-checkout", idempotencyKey),
	}
	input.PaymentProvisioner = func(provisionContext context.Context, externalReference, payerActorID string, amountMinor int64, paymentIdempotencyKey, paymentCorrelationID string) (postgres.ProvisionedPayment, error) {
		intent, _, provisionErr := s.payment.Create(provisionContext, externalReference, payerActorID, amountMinor, paymentIdempotencyKey, paymentCorrelationID)
		if provisionErr != nil {
			return postgres.ProvisionedPayment{}, provisionErr
		}
		return postgres.ProvisionedPayment{IntentID: intent.ID, State: intent.State}, nil
	}
	input.PaymentCanceller = func(compensationContext context.Context, intentID, reason, cancellationKey, paymentCorrelationID string) error {
		_, cancelErr := s.payment.EnsureCancelled(compensationContext, intentID, reason, cancellationKey, paymentCorrelationID)
		return cancelErr
	}
	input.RequestHash = postgres.HashCheckoutRequest(input)
	return postgres.CreateOrderFromCart(ctx, s.db, input)
}

func (s *Service) requireClient(ctx context.Context, accessToken string) (string, error) {
	identity, err := s.identity.ReadSession(ctx, strings.TrimSpace(accessToken))
	if err != nil {
		return "", err
	}
	if identity.Role != "client" || identity.Surface != "app-client" || strings.TrimSpace(identity.Subject) == "" {
		return "", ErrClientSessionForbidden
	}
	return identity.Subject, nil
}
