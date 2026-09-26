package multistore

import (
	"errors"
	"fmt"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestUnknownPaymentOutcomeCannotBecomeDefinitiveChildFailure(t *testing.T) {
	err := fmt.Errorf("%w: %w", postgres.ErrExternalOutcomeUnknown, postgres.ErrCheckoutEvidenceStale)
	if isDefinitiveChildCheckoutError(err) {
		t.Fatal("an unknown external payment outcome was treated as a definitive child failure")
	}
	if got := childFailureCode(err); got != "PAYMENT_OUTCOME_UNKNOWN" {
		t.Fatalf("unknown child failure code = %q", got)
	}
	if !errors.Is(err, postgres.ErrCheckoutEvidenceStale) {
		t.Fatal("test error no longer retains its underlying stale cause")
	}
}
