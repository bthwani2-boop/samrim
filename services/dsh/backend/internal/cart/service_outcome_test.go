package cart

import (
	"errors"
	"net/http"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestExternalMutationOutcomeKeepsAmbiguousWLTResponsesRecoverable(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		code      string
		ambiguous bool
	}{
		{name: "validation rejected before mutation", status: http.StatusBadRequest, code: "INVALID_INPUT"},
		{name: "allocation rejected before mutation", status: http.StatusBadRequest, code: "INVALID_PAYMENT_ALLOCATION"},
		{name: "idempotency facts conflict", status: http.StatusConflict, code: "IDEMPOTENCY_CONFLICT", ambiguous: true},
		{name: "payment already exists", status: http.StatusConflict, code: "PAYMENT_EXISTS", ambiguous: true},
		{name: "gateway failure", status: http.StatusBadGateway, code: "WLT_STORAGE_UNAVAILABLE", ambiguous: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cause := &wlt.Error{Status: test.status, Code: test.code}
			got := externalMutationOutcome(cause)
			if errors.Is(got, postgres.ErrExternalOutcomeUnknown) != test.ambiguous {
				t.Fatalf("externalMutationOutcome(%d/%s) unknown=%t, want %t", test.status, test.code, errors.Is(got, postgres.ErrExternalOutcomeUnknown), test.ambiguous)
			}
			if !errors.Is(got, cause) {
				t.Fatalf("externalMutationOutcome(%d/%s) did not preserve the WLT error", test.status, test.code)
			}
		})
	}
}
