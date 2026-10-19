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
		{name: "internal balance contribution", change: func(input *CheckoutInput) { input.InternalBalanceAmountMinor = 1 }},
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

func TestCheckoutReplayBindsDeliveryRecipient(t *testing.T) {
	name, phone, instructions := "Ali", "+967712345678", "Gate 2"
	input := CheckoutInput{ClientActorID: "client", CartID: "cart", StoreID: "store", AddressID: "address", FulfillmentMode: FulfillmentModeBthwaniCaptain, PaymentMethod: "CASH_ON_DELIVERY", Recipient: DeliveryRecipientInput{Mode: "OTHER", Name: name, PhoneE164: phone, Instructions: instructions}}
	order := OrderRecord{ClientActorID: input.ClientActorID, CartID: input.CartID, StoreID: input.StoreID, AddressID: input.AddressID, FulfillmentMode: input.FulfillmentMode, PaymentMethod: input.PaymentMethod, Recipient: DeliveryRecipientRecord{Mode: "OTHER", Name: &name, PhoneE164: &phone, Instructions: &instructions}}
	if !checkoutOrderMatchesRequest(order, input) {
		t.Fatal("matching alternate recipient was rejected during checkout recovery")
	}
	input.Recipient.PhoneE164 = "+967700000000"
	if checkoutOrderMatchesRequest(order, input) {
		t.Fatal("changed recipient was accepted for the existing checkout idempotency key")
	}
}

func TestCheckoutRequestHashPreservesCashOnlyReplayAndBindsBalanceContribution(t *testing.T) {
	input := CheckoutInput{ClientActorID: "client-1", CartID: "cart-1", StoreID: "store-1", AddressID: "address-1", FulfillmentMode: FulfillmentModeBthwaniCaptain, PaymentMethod: "CASH_ON_DELIVERY", ExpectedCartVersion: 4, PromotionCode: "SAVE10"}
	legacyCashOnlyHash := hashFacts(input.ClientActorID, input.CartID, input.StoreID, input.AddressID, input.FulfillmentMode, input.PaymentMethod, "4", "", "", "", "0", "0", "SAVE10")
	if got := HashCheckoutRequest(input); got != legacyCashOnlyHash {
		t.Fatal("cash-only checkout hash changed and would break existing idempotent replays")
	}
	input.InternalBalanceAmountMinor = 100
	if got := HashCheckoutRequest(input); got == legacyCashOnlyHash {
		t.Fatal("balance contribution was not bound to checkout idempotency")
	}
}

func TestCheckoutRecipientNormalizationAndIdempotency(t *testing.T) {
	base := CheckoutInput{ClientActorID: "client", CartID: "cart", StoreID: "store", AddressID: "address", FulfillmentMode: FulfillmentModeBthwaniCaptain, PaymentMethod: "CASH_ON_DELIVERY", ExpectedCartVersion: 1}
	legacyHash := HashCheckoutRequest(base)
	self, err := NormalizeDeliveryRecipient(DeliveryRecipientInput{}, FulfillmentModeBthwaniCaptain)
	if err != nil {
		t.Fatalf("default recipient normalization failed: %v", err)
	}
	base.Recipient = self
	if HashCheckoutRequest(base) != legacyHash {
		t.Fatal("explicit SELF recipient changed the legacy checkout idempotency identity")
	}
	base.Recipient = DeliveryRecipientInput{Mode: "OTHER", Name: "  Ali  ", PhoneE164: " +967712345678 ", Instructions: "  Gate 2  "}
	normalized, err := NormalizeDeliveryRecipient(base.Recipient, base.FulfillmentMode)
	if err != nil {
		t.Fatalf("valid alternate recipient was rejected: %v", err)
	}
	base.Recipient = normalized
	otherHash := HashCheckoutRequest(base)
	if otherHash == legacyHash {
		t.Fatal("alternate recipient was not bound to checkout idempotency")
	}
	base.Recipient.Name = "Different recipient"
	if HashCheckoutRequest(base) == otherHash {
		t.Fatal("changed recipient facts retained the same checkout idempotency identity")
	}
	localRecipient, err := NormalizeDeliveryRecipient(DeliveryRecipientInput{Mode: "OTHER", Name: "Ali", PhoneE164: "777123456"}, base.FulfillmentMode)
	if err != nil || localRecipient.PhoneE164 != "+967777123456" {
		t.Fatalf("local Yemeni recipient phone was not normalized: %+v, %v", localRecipient, err)
	}
}

func TestNormalizeDeliveryRecipientRejectsInvalidOrPickupOther(t *testing.T) {
	tests := []struct {
		name string
		mode string
		data DeliveryRecipientInput
	}{
		{name: "self with unrelated personal data", mode: FulfillmentModeBthwaniCaptain, data: DeliveryRecipientInput{Mode: "SELF", Name: "Ali"}},
		{name: "other without name", mode: FulfillmentModeBthwaniCaptain, data: DeliveryRecipientInput{Mode: "OTHER", PhoneE164: "+967712345678"}},
		{name: "other with malformed phone", mode: FulfillmentModeBthwaniCaptain, data: DeliveryRecipientInput{Mode: "OTHER", Name: "Ali", PhoneE164: "77123456"}},
		{name: "other for pickup", mode: FulfillmentModeCustomerPickup, data: DeliveryRecipientInput{Mode: "OTHER", Name: "Ali", PhoneE164: "+967712345678"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NormalizeDeliveryRecipient(test.data, test.mode); !errors.Is(err, ErrCheckoutRecipientInvalid) {
				t.Fatalf("NormalizeDeliveryRecipient() error = %v, want %v", err, ErrCheckoutRecipientInvalid)
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
