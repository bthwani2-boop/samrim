package cart

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/serviceability"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var (
	ErrClientSessionForbidden     = errors.New("an active app-client session is required")
	ErrCheckoutNotServiceable     = errors.New("address is not serviceable for this Store")
	ErrFulfillmentModeUnavailable = errors.New("the requested fulfillment mode is not available")
)

const FulfillmentModeBthwaniCaptain = "BTHWANI_CAPTAIN"

type Service struct {
	identity       *identityintegration.Client
	db             *sql.DB
	serviceability *serviceability.Service
	payment        *wlt.Client
}

type CheckoutQuote struct {
	CartID                string
	StoreID               string
	AddressID             string
	FulfillmentMode       string
	CartVersion           int
	SubtotalMinor         int64
	DiscountMinor         int64
	PromotionID           string
	PromotionCode         string
	DeliveryFeeMinor      int64
	TotalAmountMinor      int64
	Currency              string
	DeliveryPolicyVersion string
	ServiceCityID         string
	QuotedAt              time.Time
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

func (s *Service) Quote(ctx context.Context, accessToken, cartID, storeID, addressID, fulfillmentMode, promotionCode string, expectedCartVersion int) (CheckoutQuote, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return CheckoutQuote{}, err
	}
	cartID, storeID, addressID = strings.TrimSpace(cartID), strings.TrimSpace(storeID), strings.TrimSpace(addressID)
	fulfillmentMode = strings.TrimSpace(fulfillmentMode)
	if fulfillmentMode != FulfillmentModeBthwaniCaptain {
		return CheckoutQuote{}, ErrFulfillmentModeUnavailable
	}
	if cartID == "" || storeID == "" || addressID == "" || expectedCartVersion < 1 {
		return CheckoutQuote{}, postgres.ErrCheckoutEvidenceStale
	}
	serviceabilityResult, err := s.serviceability.Evaluate(ctx, accessToken, storeID, addressID)
	if err != nil {
		return CheckoutQuote{}, err
	}
	if serviceabilityResult.Status != "SERVICEABLE" {
		return CheckoutQuote{}, ErrCheckoutNotServiceable
	}
	cart, err := postgres.ReadOpenCart(ctx, s.db, actorID, storeID)
	if err != nil {
		return CheckoutQuote{}, err
	}
	if cart.ID != cartID || cart.StoreID != storeID || cart.Version != expectedCartVersion {
		return CheckoutQuote{}, postgres.ErrCheckoutEvidenceStale
	}

	subtotal := new(big.Int)
	orderSize := new(big.Int)
	currency := ""
	for _, line := range cart.Lines {
		if line.LineAmountMinor <= 0 || line.QuantityBaseUnits <= 0 || strings.TrimSpace(line.Currency) != "YER" {
			return CheckoutQuote{}, postgres.ErrCheckoutEvidenceStale
		}
		if currency == "" {
			currency = line.Currency
		} else if currency != line.Currency {
			return CheckoutQuote{}, postgres.ErrCheckoutEvidenceStale
		}
		subtotal.Add(subtotal, big.NewInt(line.LineAmountMinor))
		orderSize.Add(orderSize, big.NewInt(line.QuantityBaseUnits))
	}
	if len(cart.Lines) == 0 || subtotal.Sign() <= 0 || orderSize.Sign() <= 0 || !subtotal.IsInt64() || !orderSize.IsInt64() {
		return CheckoutQuote{}, postgres.ErrCartEmpty
	}
	var discountMinor int64
	var promotionID, normalizedPromotionCode string
	normalizedPromotionCode = strings.ToUpper(strings.TrimSpace(promotionCode))
	if normalizedPromotionCode != "" {
		promotion, discount, promotionErr := postgres.EvaluatePromotion(ctx, s.db, normalizedPromotionCode, storeID, actorID, subtotal.Int64(), false)
		if promotionErr != nil {
			return CheckoutQuote{}, promotionErr
		}
		discountMinor = discount
		promotionID = promotion.ID
	}

	facts := serviceabilityResult.Facts
	feeQuote, err := s.quoteDeliveryFee(ctx, postgres.DeliveryFeeQuoteInput{ServiceCityID: facts.StoreServiceCityID, OriginLatitude: facts.StoreOriginLatitude, OriginLongitude: facts.StoreOriginLongitude, DestinationLatitude: facts.AddressLatitude, DestinationLongitude: facts.AddressLongitude, OrderSizeBaseUnits: orderSize.Int64()})
	if err != nil || feeQuote.FeeMinor < 0 || strings.TrimSpace(feeQuote.PolicyVersion) == "" {
		return CheckoutQuote{}, postgres.ErrDeliveryFeeUnavailable
	}
	total := new(big.Int).Sub(subtotal, big.NewInt(discountMinor))
	total.Add(total, big.NewInt(feeQuote.FeeMinor))
	if !total.IsInt64() || total.Sign() <= 0 {
		return CheckoutQuote{}, postgres.ErrDeliveryFeeUnavailable
	}
	return CheckoutQuote{
		CartID:                cart.ID,
		StoreID:               cart.StoreID,
		AddressID:             addressID,
		FulfillmentMode:       fulfillmentMode,
		CartVersion:           cart.Version,
		SubtotalMinor:         subtotal.Int64(),
		DiscountMinor:         discountMinor,
		PromotionID:           promotionID,
		PromotionCode:         normalizedPromotionCode,
		DeliveryFeeMinor:      feeQuote.FeeMinor,
		TotalAmountMinor:      total.Int64(),
		Currency:              currency,
		DeliveryPolicyVersion: feeQuote.PolicyVersion,
		ServiceCityID:         facts.StoreServiceCityID,
		QuotedAt:              time.Now().UTC(),
	}, nil
}

func (s *Service) Checkout(ctx context.Context, accessToken, cartID, storeID, addressID, fulfillmentMode, promotionCode string, expectedCartVersion int, idempotencyKey, correlationID string) (postgres.OrderRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	fulfillmentMode = strings.TrimSpace(fulfillmentMode)
	if fulfillmentMode != FulfillmentModeBthwaniCaptain {
		return postgres.OrderRecord{}, false, ErrFulfillmentModeUnavailable
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
		ClientActorID: actorID, CartID: strings.TrimSpace(cartID), StoreID: strings.TrimSpace(storeID), AddressID: strings.TrimSpace(addressID), FulfillmentMode: fulfillmentMode, ExpectedCartVersion: expectedCartVersion, PromotionCode: strings.ToUpper(strings.TrimSpace(promotionCode)),
		Evidence:       postgres.CheckoutEvidence{ServiceCityID: facts.StoreServiceCityID, PolicyVersion: serviceability.PolicyVersion, Status: serviceabilityResult.Status, StoreVersion: facts.StoreVersion, AddressVersion: facts.AddressVersion, StoreOriginLatitude: facts.StoreOriginLatitude, StoreOriginLongitude: facts.StoreOriginLongitude, AddressLatitude: facts.AddressLatitude, AddressLongitude: facts.AddressLongitude},
		IdempotencyKey: strings.TrimSpace(idempotencyKey), ActingActorID: actorID, CorrelationID: strings.TrimSpace(correlationID),
		PaymentExternalReference: wlt.DerivedExternalReference("checkout", idempotencyKey),
		PaymentIdempotencyKey:    wlt.DerivedIdempotencyKey("create", idempotencyKey),
		PaymentCancellationKey:   wlt.DerivedIdempotencyKey("cancel-checkout", idempotencyKey),
	}
	input.DeliveryFeeResolver = s.quoteDeliveryFee
	input.PaymentProvisioner = func(provisionContext context.Context, orderID, externalReference, payerActorID string, subtotalMinor, discountMinor, deliveryFeeMinor int64, deliveryPolicyVersion string, amountMinor int64, paymentIdempotencyKey, paymentCorrelationID string) (postgres.ProvisionedPayment, error) {
		allocation := wlt.CustomerPaymentAllocation{OrderID: orderID, Currency: "YER", SubtotalMinor: subtotalMinor, DeliveryFeeMinor: deliveryFeeMinor, DiscountMinor: discountMinor, CashAmountMinor: amountMinor, CustomerPayableMinor: amountMinor, PolicyVersion: fmt.Sprintf("cod-current-v2;delivery=%s", deliveryPolicyVersion)}
		intent, _, provisionErr := s.payment.CreateForOrder(provisionContext, orderID, externalReference, payerActorID, amountMinor, allocation, paymentIdempotencyKey, paymentCorrelationID)
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

func (s *Service) quoteDeliveryFee(ctx context.Context, input postgres.DeliveryFeeQuoteInput) (postgres.DeliveryFeeQuote, error) {
	quote, err := s.payment.QuoteDeliveryFee(ctx, wlt.DeliveryFeeQuoteInput{ServiceCityID: input.ServiceCityID, OriginLatitude: input.OriginLatitude, OriginLongitude: input.OriginLongitude, DestinationLatitude: input.DestinationLatitude, DestinationLongitude: input.DestinationLongitude, OrderSizeBaseUnits: input.OrderSizeBaseUnits})
	if err != nil {
		return postgres.DeliveryFeeQuote{}, err
	}
	return postgres.DeliveryFeeQuote{FeeMinor: quote.FeeMinor, PolicyVersion: quote.PolicyVersion}, nil
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
