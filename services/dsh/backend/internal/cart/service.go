package cart

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"net/http"
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
const FulfillmentModePartnerCaptain = "PARTNER_CAPTAIN"
const FulfillmentModeCustomerPickup = "CUSTOMER_PICKUP"
const PaymentMethodCashAtStore = "CASH_AT_STORE"

type Service struct {
	identity       *identityintegration.Client
	db             *sql.DB
	serviceability *serviceability.Service
	payment        *wlt.Client
	proofKeys      *postgres.DeliveryProofKeyring
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

func New(identity *identityintegration.Client, db *sql.DB, serviceabilityService *serviceability.Service, payment *wlt.Client, proofKeys *postgres.DeliveryProofKeyring) (*Service, error) {
	if identity == nil || db == nil || serviceabilityService == nil || payment == nil || proofKeys == nil {
		return nil, errors.New("cart configuration is invalid")
	}
	return &Service{identity: identity, db: db, serviceability: serviceabilityService, payment: payment, proofKeys: proofKeys}, nil
}

func (s *Service) ListOpenCarts(ctx context.Context, accessToken string) ([]postgres.ClientOpenCartRecord, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return postgres.ListClientOpenCarts(ctx, s.db, actorID)
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
	if fulfillmentMode != FulfillmentModeBthwaniCaptain && fulfillmentMode != FulfillmentModePartnerCaptain && fulfillmentMode != FulfillmentModeCustomerPickup {
		return CheckoutQuote{}, ErrFulfillmentModeUnavailable
	}
	if cartID == "" || storeID == "" || expectedCartVersion < 1 || (fulfillmentMode != FulfillmentModeCustomerPickup && addressID == "") || (fulfillmentMode == FulfillmentModeCustomerPickup && addressID != "") {
		return CheckoutQuote{}, postgres.ErrCheckoutEvidenceStale
	}
	cart, err := postgres.ReadOpenCart(ctx, s.db, actorID, storeID)
	if err != nil {
		return CheckoutQuote{}, err
	}
	if cart.ID != cartID || cart.StoreID != storeID || cart.Version != expectedCartVersion {
		return CheckoutQuote{}, postgres.ErrCheckoutEvidenceStale
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil || store.PublicationState != "published" || strings.TrimSpace(store.PartnerActorID) == "" || !supportsFulfillmentMode(store.FulfillmentModes, fulfillmentMode) {
		return CheckoutQuote{}, ErrFulfillmentModeUnavailable
	}
	serviceCityID := store.ServiceCityID
	var originLatitude, originLongitude, destinationLatitude, destinationLongitude float64
	var deliveryPolicyVersion string
	if fulfillmentMode == FulfillmentModeCustomerPickup {
		deliveryPolicyVersion = "NOT_APPLICABLE"
	} else {
		serviceabilityResult, serviceabilityErr := s.serviceability.Evaluate(ctx, accessToken, storeID, addressID)
		if serviceabilityErr != nil {
			return CheckoutQuote{}, serviceabilityErr
		}
		if serviceabilityResult.Status != "SERVICEABLE" {
			return CheckoutQuote{}, ErrCheckoutNotServiceable
		}
		facts := serviceabilityResult.Facts
		serviceCityID = facts.StoreServiceCityID
		originLatitude, originLongitude = facts.StoreOriginLatitude, facts.StoreOriginLongitude
		destinationLatitude, destinationLongitude = facts.AddressLatitude, facts.AddressLongitude
		deliveryPolicyVersion = serviceability.PolicyVersion
	}
	if fulfillmentMode == FulfillmentModePartnerCaptain {
		deliveryPolicyVersion = "NOT_APPLICABLE"
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

	feeQuote := postgres.DeliveryFeeQuote{FeeMinor: 0, PolicyVersion: "NOT_APPLICABLE"}
	if fulfillmentMode == FulfillmentModeBthwaniCaptain {
		feeQuote, err = s.quoteDeliveryFee(ctx, postgres.DeliveryFeeQuoteInput{ServiceCityID: serviceCityID, OriginLatitude: originLatitude, OriginLongitude: originLongitude, DestinationLatitude: destinationLatitude, DestinationLongitude: destinationLongitude, OrderSizeBaseUnits: orderSize.Int64()})
		if err != nil || feeQuote.FeeMinor < 0 || strings.TrimSpace(feeQuote.PolicyVersion) == "" {
			return CheckoutQuote{}, postgres.ErrDeliveryFeeUnavailable
		}
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
		DeliveryPolicyVersion: deliveryPolicyVersion,
		ServiceCityID:         serviceCityID,
		QuotedAt:              time.Now().UTC(),
	}, nil
}

func (s *Service) Checkout(ctx context.Context, accessToken, cartID, storeID, addressID, fulfillmentMode, promotionCode string, expectedCartVersion int, idempotencyKey, correlationID string) (postgres.OrderRecord, bool, error) {
	actorID, err := s.requireClient(ctx, accessToken)
	if err != nil {
		return postgres.OrderRecord{}, false, err
	}
	fulfillmentMode = strings.TrimSpace(fulfillmentMode)
	cartID, storeID, addressID = strings.TrimSpace(cartID), strings.TrimSpace(storeID), strings.TrimSpace(addressID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if cartID == "" {
		return postgres.OrderRecord{}, false, postgres.ErrCheckoutEvidenceStale
	}
	paymentExternalReference := wlt.DerivedExternalReference("checkout", idempotencyKey)
	paymentCancellationKey := wlt.DerivedIdempotencyKey("cancel-checkout", idempotencyKey)
	paymentRecoveryReader := s.paymentIntentRecoveryReader()
	paymentCanceller := s.paymentIntentCanceller()
	paymentMethod := "CASH_ON_DELIVERY"
	if fulfillmentMode == FulfillmentModeCustomerPickup || fulfillmentMode == FulfillmentModePartnerCaptain {
		paymentMethod = PaymentMethodCashAtStore
	}
	attemptInput := postgres.CheckoutInput{
		ClientActorID: actorID, CartID: cartID, StoreID: storeID, AddressID: addressID,
		FulfillmentMode: fulfillmentMode, ExpectedCartVersion: expectedCartVersion,
		IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
		PaymentExternalReference: paymentExternalReference, PaymentCancellationKey: paymentCancellationKey,
		PaymentMethod: paymentMethod, PromotionCode: strings.ToUpper(strings.TrimSpace(promotionCode)),
		PaymentIntentRecoveryReader: paymentRecoveryReader, PaymentCanceller: paymentCanceller,
	}
	resolvedOrder, replayed, resolveErr := postgres.ResolveCheckoutAttempt(ctx, s.db, attemptInput)
	if resolveErr != nil {
		return postgres.OrderRecord{}, false, resolveErr
	}
	if replayed {
		return resolvedOrder, true, nil
	}
	if fulfillmentMode != FulfillmentModeBthwaniCaptain && fulfillmentMode != FulfillmentModePartnerCaptain && fulfillmentMode != FulfillmentModeCustomerPickup {
		return postgres.OrderRecord{}, false, ErrFulfillmentModeUnavailable
	}
	if storeID == "" || expectedCartVersion < 1 || (fulfillmentMode != FulfillmentModeCustomerPickup && addressID == "") || (fulfillmentMode == FulfillmentModeCustomerPickup && addressID != "") {
		return postgres.OrderRecord{}, false, postgres.ErrCheckoutEvidenceStale
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil || store.PublicationState != "published" || !supportsFulfillmentMode(store.FulfillmentModes, fulfillmentMode) {
		return postgres.OrderRecord{}, false, ErrFulfillmentModeUnavailable
	}
	var evidence postgres.CheckoutEvidence
	if fulfillmentMode == FulfillmentModeCustomerPickup {
		evidence = postgres.CheckoutEvidence{ServiceCityID: store.ServiceCityID, StoreVersion: store.Version}
	} else {
		serviceabilityResult, serviceabilityErr := s.serviceability.Evaluate(ctx, accessToken, storeID, addressID)
		if serviceabilityErr != nil {
			return postgres.OrderRecord{}, false, serviceabilityErr
		}
		if serviceabilityResult.Status != "SERVICEABLE" {
			return postgres.OrderRecord{}, false, ErrCheckoutNotServiceable
		}
		facts := serviceabilityResult.Facts
		evidence = postgres.CheckoutEvidence{ServiceCityID: facts.StoreServiceCityID, PolicyVersion: serviceability.PolicyVersion, Status: serviceabilityResult.Status, StoreVersion: facts.StoreVersion, AddressVersion: facts.AddressVersion, StoreOriginLatitude: facts.StoreOriginLatitude, StoreOriginLongitude: facts.StoreOriginLongitude, AddressLatitude: facts.AddressLatitude, AddressLongitude: facts.AddressLongitude}
	}
	input := postgres.CheckoutInput{
		ClientActorID: actorID, CartID: cartID, StoreID: storeID, AddressID: addressID, FulfillmentMode: fulfillmentMode, ExpectedCartVersion: expectedCartVersion, PromotionCode: strings.ToUpper(strings.TrimSpace(promotionCode)), PaymentMethod: paymentMethod, DeliveryProofKeyring: s.proofKeys,
		Evidence:       evidence,
		IdempotencyKey: idempotencyKey, ActingActorID: actorID, CorrelationID: correlationID,
		PaymentExternalReference: paymentExternalReference,
		PaymentIdempotencyKey:    wlt.DerivedIdempotencyKey("create", idempotencyKey),
		PaymentCancellationKey:   paymentCancellationKey,
	}
	input.DeliveryFeeResolver = s.quoteDeliveryFee
	input.PaymentProvisioner = func(provisionContext context.Context, orderID, externalReference, payerActorID string, subtotalMinor, discountMinor, deliveryFeeMinor int64, deliveryPolicyVersion string, amountMinor int64, paymentIdempotencyKey, paymentCorrelationID string) (postgres.ProvisionedPayment, error) {
		allocationPolicy := fmt.Sprintf("cod-current-v2;delivery=%s", deliveryPolicyVersion)
		if fulfillmentMode == FulfillmentModeCustomerPickup {
			allocationPolicy = "cash-at-store-v1"
		} else if fulfillmentMode == FulfillmentModePartnerCaptain {
			allocationPolicy = "store-captain-cash-v1"
		}
		if err := s.payment.EnsurePartnerStoreCommissionPolicies(provisionContext, store.ID, store.PartnerActorID, wlt.DerivedIdempotencyKey("ensure-store-commission-policy", store.ID), paymentCorrelationID); err != nil {
			return postgres.ProvisionedPayment{}, externalMutationOutcome(err)
		}
		allocation := wlt.CustomerPaymentAllocation{OrderID: orderID, StoreID: store.ID, PartnerActorID: store.PartnerActorID, FulfillmentMode: fulfillmentMode, Currency: "YER", SubtotalMinor: subtotalMinor, DeliveryFeeMinor: deliveryFeeMinor, DiscountMinor: discountMinor, CashAmountMinor: amountMinor, CustomerPayableMinor: amountMinor, PolicyVersion: allocationPolicy}
		intent, _, provisionErr := s.payment.CreateForOrderWithMethod(provisionContext, orderID, externalReference, payerActorID, amountMinor, paymentMethod, allocation, paymentIdempotencyKey, paymentCorrelationID)
		if provisionErr != nil {
			return postgres.ProvisionedPayment{}, externalMutationOutcome(provisionErr)
		}
		return postgres.ProvisionedPayment{IntentID: intent.ID, State: intent.State}, nil
	}
	input.PaymentIntentRecoveryReader = paymentRecoveryReader
	input.PaymentCanceller = paymentCanceller
	input.RequestHash = postgres.HashCheckoutRequest(input)
	return postgres.CreateOrderFromCart(ctx, s.db, input)
}

func (s *Service) paymentIntentRecoveryReader() postgres.PaymentIntentRecoveryReader {
	return func(ctx context.Context, externalReference string) (postgres.PaymentIntentRecoveryRecord, bool, error) {
		intent, err := s.payment.ReadByExternalReference(ctx, externalReference)
		if err != nil {
			var wltErr *wlt.Error
			if errors.As(err, &wltErr) && wltErr.Status == http.StatusNotFound && wltErr.Code == "NOT_FOUND" {
				return postgres.PaymentIntentRecoveryRecord{}, false, nil
			}
			return postgres.PaymentIntentRecoveryRecord{}, false, err
		}
		orderID := ""
		if intent.CustomerPaymentAllocation != nil {
			orderID = intent.CustomerPaymentAllocation.OrderID
		}
		return postgres.PaymentIntentRecoveryRecord{IntentID: intent.ID, ExternalReference: intent.ExternalReference, PayerActorID: intent.PayerActorID, OrderID: orderID, Method: intent.Method, State: intent.State}, true, nil
	}
}

func (s *Service) paymentIntentCanceller() postgres.PaymentIntentCanceller {
	return func(ctx context.Context, intentID, reason, idempotencyKey, correlationID string) error {
		cancelled, err := s.payment.EnsureCancelled(ctx, intentID, reason, idempotencyKey, correlationID)
		if err != nil {
			return externalMutationOutcome(err)
		}
		if cancelled.ID != intentID || cancelled.State != "CANCELLED" {
			return fmt.Errorf("%w: WLT did not confirm payment cancellation", postgres.ErrExternalOutcomeUnknown)
		}
		return nil
	}
}

func supportsFulfillmentMode(modes []string, requested string) bool {
	for _, mode := range modes {
		if mode == requested {
			return true
		}
	}
	return false
}

func externalMutationOutcome(err error) error {
	if err == nil {
		return nil
	}
	var responseErr *wlt.Error
	if errors.As(err, &responseErr) && responseErr.Status == http.StatusBadRequest && (responseErr.Code == "INVALID_INPUT" || responseErr.Code == "INVALID_PAYMENT_ALLOCATION") {
		return err
	}
	return fmt.Errorf("%w: %w", postgres.ErrExternalOutcomeUnknown, err)
}

func (s *Service) quoteDeliveryFee(ctx context.Context, input postgres.DeliveryFeeQuoteInput) (postgres.DeliveryFeeQuote, error) {
	quote, err := s.payment.QuoteDeliveryFee(ctx, wlt.DeliveryFeeQuoteInput{ServiceCityID: input.ServiceCityID, OriginLatitude: input.OriginLatitude, OriginLongitude: input.OriginLongitude, DestinationLatitude: input.DestinationLatitude, DestinationLongitude: input.DestinationLongitude, OrderSizeBaseUnits: input.OrderSizeBaseUnits})
	if err != nil {
		return postgres.DeliveryFeeQuote{}, fmt.Errorf("%w: %w", postgres.ErrDeliveryFeeUnavailable, err)
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
