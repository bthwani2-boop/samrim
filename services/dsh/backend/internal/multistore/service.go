package multistore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/cart"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	orderdomain "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/order"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrClientSessionForbidden = errors.New("an active app-client session is required")
	ErrCheckoutInProgress     = errors.New("multi-store checkout is still processing")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	cart     *cart.Service
	order    *orderdomain.Service
}

func New(identity *identityintegration.Client, db *sql.DB, cartService *cart.Service, orderService *orderdomain.Service) (*Service, error) {
	if identity == nil || db == nil || cartService == nil || orderService == nil {
		return nil, errors.New("multi-store checkout configuration is invalid")
	}
	return &Service{identity: identity, db: db, cart: cartService, order: orderService}, nil
}

func (s *Service) Checkout(ctx context.Context, accessToken string, input postgres.MultiStoreCheckoutInput, idempotencyKey, correlationID string) (postgres.MultiStoreCheckoutRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.MultiStoreCheckoutRecord{}, false, err
	}
	input.ClientActorID = actorID
	input.ID = strings.TrimSpace(input.ID)
	for index := range input.Children {
		input.Children[index].CartID = strings.TrimSpace(input.Children[index].CartID)
		input.Children[index].StoreID = strings.TrimSpace(input.Children[index].StoreID)
		input.Children[index].AddressID = strings.TrimSpace(input.Children[index].AddressID)
		input.Children[index].FulfillmentMode = strings.TrimSpace(input.Children[index].FulfillmentMode)
		input.Children[index].PromotionCode = strings.ToUpper(strings.TrimSpace(input.Children[index].PromotionCode))
	}
	requestHash := postgres.HashMultiStoreCheckoutRequest(input)
	checkout, replayed, err := postgres.CreateMultiStoreCheckout(ctx, s.db, input, strings.TrimSpace(idempotencyKey), requestHash)
	if err != nil {
		return postgres.MultiStoreCheckoutRecord{}, false, err
	}
	if replayed && checkout.State != "PROCESSING" {
		return checkout, true, nil
	}
	for _, child := range checkout.Children {
		if child.State != "PENDING" {
			continue
		}
		childInput := inputForChild(child)
		childKey := postgres.HashMarketingFacts("multi-store-child-checkout", checkout.ID, child.ID)
		childCorrelation := postgres.HashMarketingFacts("multi-store-child-correlation", strings.TrimSpace(correlationID), checkout.ID, child.ID)
		order, _, checkoutErr := s.cart.Checkout(ctx, accessToken, childInput.CartID, childInput.StoreID, childInput.AddressID, childInput.FulfillmentMode, childInput.PromotionCode, childInput.CartVersion, childKey, childCorrelation)
		if checkoutErr != nil {
			if !isDefinitiveChildCheckoutError(checkoutErr) {
				return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
			}
			if _, markErr := postgres.MarkMultiStoreCheckoutChildFailed(ctx, s.db, checkout.ID, child.ID, childFailureCode(checkoutErr), childFailureMessage(checkoutErr)); markErr != nil {
				return postgres.MultiStoreCheckoutRecord{}, false, markErr
			}
			continue
		}
		if _, markErr := postgres.MarkMultiStoreCheckoutChildSucceeded(ctx, s.db, checkout.ID, child.ID, order.ID); markErr != nil {
			return postgres.MultiStoreCheckoutRecord{}, false, markErr
		}
	}
	result, err := postgres.ReadMultiStoreCheckoutForClient(ctx, s.db, checkout.ID, actorID)
	return result, replayed, err
}

func isDefinitiveChildCheckoutError(err error) bool {
	if errors.Is(err, postgres.ErrExternalOutcomeUnknown) {
		return false
	}
	switch {
	case errors.Is(err, postgres.ErrCheckoutPaymentReconciled),
		errors.Is(err, postgres.ErrCheckoutEvidenceStale), errors.Is(err, postgres.ErrCartVersionConflict),
		errors.Is(err, cart.ErrCheckoutNotServiceable), errors.Is(err, cart.ErrFulfillmentModeUnavailable),
		errors.Is(err, postgres.ErrCatalogInventoryInsufficient), errors.Is(err, postgres.ErrCatalogInventoryInvalid),
		errors.Is(err, postgres.ErrPromotionUnavailable), errors.Is(err, postgres.ErrPromotionAlreadyRedeemed),
		errors.Is(err, postgres.ErrPromotionLimitReached):
		return true
	case errors.Is(err, postgres.ErrPaymentProvisioning):
		return !errors.Is(err, postgres.ErrExternalOutcomeUnknown)
	default:
		return false
	}
}

func (s *Service) Read(ctx context.Context, accessToken, checkoutID string) (postgres.MultiStoreCheckoutRecord, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.MultiStoreCheckoutRecord{}, err
	}
	return postgres.ReadMultiStoreCheckoutForClient(ctx, s.db, strings.TrimSpace(checkoutID), actorID)
}

func (s *Service) Cancel(ctx context.Context, accessToken, checkoutID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.MultiStoreCheckoutRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.MultiStoreCheckoutRecord{}, false, err
	}
	checkoutID = strings.TrimSpace(checkoutID)
	current, err := postgres.ReadMultiStoreCheckoutForClient(ctx, s.db, checkoutID, actorID)
	if err != nil {
		return postgres.MultiStoreCheckoutRecord{}, false, err
	}
	if current.State == "PROCESSING" {
		return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
	}
	requestHash := postgres.HashMultiStoreCheckoutCancelRequest(checkoutID, expectedVersion)
	checkout, replayed, err := postgres.BeginMultiStoreCheckoutCancel(ctx, s.db, checkoutID, actorID, strings.TrimSpace(idempotencyKey), requestHash, expectedVersion)
	if err != nil {
		return postgres.MultiStoreCheckoutRecord{}, false, err
	}
	if checkout.State == "PROCESSING" {
		return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
	}
	for _, child := range checkout.Children {
		if child.State != "SUCCEEDED" || strings.TrimSpace(child.OrderID) == "" {
			continue
		}
		order, readErr := postgres.ReadOrderForClient(ctx, s.db, child.OrderID, actorID)
		if readErr != nil {
			if errors.Is(readErr, postgres.ErrOrderNotFound) {
				if _, markErr := postgres.MarkMultiStoreCheckoutChildCancelFailed(ctx, s.db, checkout.ID, child.ID, "ORDER_NOT_FOUND", "the child Order could not be read"); markErr != nil {
					return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
				}
				continue
			}
			return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
		}
		if order.State == "CANCELLED" {
			if _, markErr := postgres.MarkMultiStoreCheckoutChildCancelled(ctx, s.db, checkout.ID, child.ID); markErr != nil {
				return postgres.MultiStoreCheckoutRecord{}, false, markErr
			}
			continue
		}
		if order.State != "CREATED" {
			if _, markErr := postgres.MarkMultiStoreCheckoutChildCancelFailed(ctx, s.db, checkout.ID, child.ID, "ORDER_NOT_CANCELLABLE", "the child Order is no longer cancellable"); markErr != nil {
				return postgres.MultiStoreCheckoutRecord{}, false, markErr
			}
			continue
		}
		childKey := postgres.HashMarketingFacts("multi-store-child-cancel", checkout.ID, child.ID)
		childCorrelation := postgres.HashMarketingFacts("multi-store-child-cancel-correlation", strings.TrimSpace(correlationID), checkout.ID, child.ID)
		if _, _, cancelErr := s.order.CancelForClient(ctx, accessToken, child.OrderID, order.Version, childKey, childCorrelation); cancelErr != nil {
			return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
		}
		if _, markErr := postgres.MarkMultiStoreCheckoutChildCancelled(ctx, s.db, checkout.ID, child.ID); markErr != nil {
			return postgres.MultiStoreCheckoutRecord{}, false, markErr
		}
	}
	result, err := postgres.ReadMultiStoreCheckoutForClient(ctx, s.db, checkout.ID, actorID)
	if err == nil {
		for _, child := range result.Children {
			if child.State == "SUCCEEDED" {
				return postgres.MultiStoreCheckoutRecord{}, false, ErrCheckoutInProgress
			}
		}
		err = postgres.CompleteMultiStoreCheckoutMutation(ctx, s.db, strings.TrimSpace(idempotencyKey), result.Version)
	}
	return result, replayed, err
}

func inputForChild(child postgres.MultiStoreCheckoutChildRecord) postgres.MultiStoreCheckoutChildInput {
	return postgres.MultiStoreCheckoutChildInput{CartID: child.CartID, StoreID: child.StoreID, AddressID: child.AddressID, FulfillmentMode: child.FulfillmentMode, PromotionCode: child.PromotionCode, CartVersion: child.CartVersion}
}

func childFailureCode(err error) string {
	switch {
	case errors.Is(err, postgres.ErrExternalOutcomeUnknown):
		return "PAYMENT_OUTCOME_UNKNOWN"
	case errors.Is(err, postgres.ErrCheckoutPaymentReconciled):
		return "PAYMENT_RECONCILED"
	case errors.Is(err, postgres.ErrCheckoutEvidenceStale), errors.Is(err, postgres.ErrCartVersionConflict):
		return "STALE_CHECKOUT"
	case errors.Is(err, cart.ErrCheckoutNotServiceable):
		return "UNSERVICEABLE"
	case errors.Is(err, cart.ErrFulfillmentModeUnavailable):
		return "FULFILLMENT_MODE_UNAVAILABLE"
	case errors.Is(err, postgres.ErrCatalogInventoryInsufficient):
		return "INVENTORY_INSUFFICIENT"
	case errors.Is(err, postgres.ErrPromotionUnavailable), errors.Is(err, postgres.ErrPromotionAlreadyRedeemed), errors.Is(err, postgres.ErrPromotionLimitReached):
		return "PROMOTION_UNAVAILABLE"
	case errors.Is(err, postgres.ErrPaymentProvisioning), errors.Is(err, postgres.ErrDeliveryFeeUnavailable):
		return "PAYMENT_UNAVAILABLE"
	default:
		return "CHILD_CHECKOUT_FAILED"
	}
}

func childFailureMessage(err error) string {
	return fmt.Sprintf("child checkout failed: %s", childFailureCode(err))
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
