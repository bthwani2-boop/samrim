package transporthttp

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestWriteCartErrorKeepsUnknownPaymentOutcomeOverStaleCause(t *testing.T) {
	response := httptest.NewRecorder()
	err := fmt.Errorf("%w: %w", postgres.ErrExternalOutcomeUnknown, postgres.ErrCheckoutEvidenceStale)

	writeCartError(response, err)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
	if !strings.Contains(response.Body.String(), "CHECKOUT_OUTCOME_UNKNOWN") {
		t.Fatalf("error response = %s", response.Body.String())
	}
}

func TestWriteCartErrorExposesSafelyReconciledPayment(t *testing.T) {
	response := httptest.NewRecorder()

	writeCartError(response, postgres.ErrCheckoutPaymentReconciled)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	if !strings.Contains(response.Body.String(), "CHECKOUT_PAYMENT_RECONCILED") {
		t.Fatalf("error response = %s", response.Body.String())
	}
}
