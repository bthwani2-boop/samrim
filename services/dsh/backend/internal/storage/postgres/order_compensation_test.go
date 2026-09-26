package postgres

import (
	"errors"
	"testing"
)

func TestPaymentCompensationFailurePreservesUnknownOutcomeAndBothErrors(t *testing.T) {
	originalErr := errors.New("order transaction failed")
	compensationErr := errors.New("payment cancellation response was lost")

	got := paymentCompensationFailure(originalErr, compensationErr)
	for _, want := range []error{ErrExternalOutcomeUnknown, originalErr, compensationErr} {
		if !errors.Is(got, want) {
			t.Fatalf("paymentCompensationFailure() did not preserve %v", want)
		}
	}
}

func TestPaymentCompensationFailureWithoutPriorErrorIsPaymentFailure(t *testing.T) {
	compensationErr := errors.New("payment cancellation failed")

	got := paymentCompensationFailure(nil, compensationErr)
	for _, want := range []error{ErrExternalOutcomeUnknown, ErrPaymentProvisioning, compensationErr} {
		if !errors.Is(got, want) {
			t.Fatalf("paymentCompensationFailure() did not preserve %v", want)
		}
	}
}
