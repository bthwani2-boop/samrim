package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestReconcileCheckoutPayment(t *testing.T) {
	const (
		clientActorID     = "client-1"
		cartID            = "cart-1"
		idempotencyKey    = "checkout-key-1"
		externalReference = "dsh-checkout-reference"
		cancellationKey   = "cancel-key-1"
		correlationID     = "correlation-1"
		paymentIntentID   = "payment-1"
	)
	basePayment := PaymentIntentRecoveryRecord{
		IntentID: paymentIntentID, ExternalReference: externalReference, PayerActorID: clientActorID,
		OrderID: stableCheckoutOrderID(clientActorID, cartID, idempotencyKey), Method: "CASH_ON_DELIVERY",
	}
	cancelFailure := errors.New("WLT cancellation outcome is unknown")

	tests := []struct {
		name        string
		payment     PaymentIntentRecoveryRecord
		found       bool
		readErr     error
		cancelErr   error
		wantErr     error
		wantCancels int
	}{
		{name: "no prior intent", payment: basePayment},
		{name: "already cancelled orphan", payment: withRecoveryState(basePayment, "CANCELLED"), found: true, wantErr: ErrCheckoutPaymentReconciled},
		{name: "active orphan is cancelled", payment: withRecoveryState(basePayment, "REQUIRES_COLLECTION"), found: true, wantErr: ErrCheckoutPaymentReconciled, wantCancels: 1},
		{name: "collected intent remains unresolved", payment: withRecoveryState(basePayment, "COLLECTED"), found: true, wantErr: ErrExternalOutcomeUnknown},
		{name: "different payer remains unresolved", payment: PaymentIntentRecoveryRecord{IntentID: paymentIntentID, ExternalReference: externalReference, PayerActorID: "client-2", OrderID: basePayment.OrderID, Method: basePayment.Method, State: "REQUIRES_COLLECTION"}, found: true, wantErr: ErrExternalOutcomeUnknown},
		{name: "uncertain cancellation remains unresolved", payment: withRecoveryState(basePayment, "REQUIRES_COLLECTION"), found: true, cancelErr: cancelFailure, wantErr: ErrExternalOutcomeUnknown, wantCancels: 1},
		{name: "lookup failure remains unresolved", readErr: errors.New("WLT unavailable"), wantErr: ErrExternalOutcomeUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cancels := 0
			reader := func(_ context.Context, gotReference string) (PaymentIntentRecoveryRecord, bool, error) {
				if gotReference != externalReference {
					t.Fatalf("external reference = %q", gotReference)
				}
				return tt.payment, tt.found, tt.readErr
			}
			canceller := func(_ context.Context, intentID, reason, key, correlation string) error {
				cancels++
				if intentID != paymentIntentID || reason != "order_creation_rolled_back" || key != cancellationKey || correlation != correlationID {
					t.Fatalf("unexpected cancellation facts: id=%q reason=%q key=%q correlation=%q", intentID, reason, key, correlation)
				}
				return tt.cancelErr
			}

			err := reconcileCheckoutPayment(context.Background(), clientActorID, cartID, idempotencyKey, externalReference, cancellationKey, correlationID, reader, canceller)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("reconciliation error = %v, want %v", err, tt.wantErr)
			}
			if cancels != tt.wantCancels {
				t.Fatalf("cancellation count = %d, want %d", cancels, tt.wantCancels)
			}
		})
	}
}

func TestCheckoutOrderMatchesRequest(t *testing.T) {
	input := CheckoutInput{ClientActorID: "client-1", CartID: "cart-1", StoreID: "store-1", AddressID: "address-1", FulfillmentMode: FulfillmentModeBthwaniCaptain, PaymentMethod: "CASH_ON_DELIVERY", PromotionCode: "SAVE10"}
	order := OrderRecord{ClientActorID: input.ClientActorID, CartID: input.CartID, StoreID: input.StoreID, AddressID: input.AddressID, FulfillmentMode: input.FulfillmentMode, PaymentMethod: input.PaymentMethod, PromotionCode: input.PromotionCode}
	input.PromotionCode = " save10 "
	if !checkoutOrderMatchesRequest(order, input) {
		t.Fatal("matching checkout request with normalized promotion was rejected")
	}
	for _, mismatch := range []struct {
		name   string
		change func(*CheckoutInput)
	}{
		{name: "client", change: func(input *CheckoutInput) { input.ClientActorID = "different-client" }},
		{name: "cart", change: func(input *CheckoutInput) { input.CartID = "different-cart" }},
		{name: "store", change: func(input *CheckoutInput) { input.StoreID = "different-store" }},
		{name: "address", change: func(input *CheckoutInput) { input.AddressID = "different-address" }},
		{name: "fulfillment", change: func(input *CheckoutInput) { input.FulfillmentMode = FulfillmentModeCustomerPickup }},
		{name: "payment method", change: func(input *CheckoutInput) { input.PaymentMethod = "CASH_AT_STORE" }},
		{name: "promotion", change: func(input *CheckoutInput) { input.PromotionCode = "DIFFERENT" }},
	} {
		t.Run(mismatch.name, func(t *testing.T) {
			changed := input
			mismatch.change(&changed)
			if checkoutOrderMatchesRequest(order, changed) {
				t.Fatal("request with different checkout facts was accepted")
			}
		})
	}
}

func TestCheckoutCartVersionMatches(t *testing.T) {
	for _, test := range []struct {
		name        string
		state       string
		version     int
		expected    int
		wantMatches bool
	}{
		{name: "original checked out cart version", state: "checked_out", version: 4, expected: 3, wantMatches: true},
		{name: "different original version", state: "checked_out", version: 4, expected: 2},
		{name: "cart is still open", state: "open", version: 4, expected: 3},
		{name: "invalid expected version", state: "checked_out", version: 1, expected: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := checkoutCartVersionMatches(test.state, test.version, test.expected); got != test.wantMatches {
				t.Fatalf("checkoutCartVersionMatches() = %t, want %t", got, test.wantMatches)
			}
		})
	}
}

func withRecoveryState(payment PaymentIntentRecoveryRecord, state string) PaymentIntentRecoveryRecord {
	payment.State = state
	return payment
}
