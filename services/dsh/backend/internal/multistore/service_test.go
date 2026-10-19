package multistore

import (
	"errors"
	"fmt"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/cart"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestChildCheckoutErrorClassification(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		definitive bool
	}{
		{name: "missing cart", err: postgres.ErrCartNotFound, definitive: true},
		{name: "empty cart", err: postgres.ErrCartEmpty, definitive: true},
		{name: "unavailable offer", err: postgres.ErrCartOfferUnavailable, definitive: true},
		{name: "invalid quantity", err: postgres.ErrCartQuantityInvalid, definitive: true},
		{name: "invalid modifier", err: postgres.ErrCartModifierInvalid, definitive: true},
		{name: "cart already consumed", err: postgres.ErrCartStateConflict, definitive: true},
		{name: "stale cart version", err: postgres.ErrCartVersionConflict, definitive: true},
		{name: "expired client session", err: cart.ErrClientSessionForbidden},
		{name: "unknown payment outcome", err: fmt.Errorf("%w: provider timeout", postgres.ErrExternalOutcomeUnknown)},
		{name: "unclassified infrastructure error", err: errors.New("database unavailable")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isDefinitiveChildCheckoutError(test.err); got != test.definitive {
				t.Fatalf("isDefinitiveChildCheckoutError(%v) = %t, want %t", test.err, got, test.definitive)
			}
		})
	}
}
