package transporthttp

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/lib/pq"
)

func TestWriteCartErrorLogsSafePersistenceDiagnostics(t *testing.T) {
	previousOutput := log.Writer()
	previousFlags := log.Flags()
	previousPrefix := log.Prefix()
	var output bytes.Buffer
	log.SetOutput(&output)
	log.SetFlags(0)
	log.SetPrefix("")
	t.Cleanup(func() {
		log.SetOutput(previousOutput)
		log.SetFlags(previousFlags)
		log.SetPrefix(previousPrefix)
	})

	response := httptest.NewRecorder()
	databaseErr := &pq.Error{
		Code:       pq.ErrorCode("23503"),
		Schema:     "dsh",
		Table:      "commerce_cart_lines",
		Constraint: "commerce_cart_lines_offer_fk",
		Detail:     "private actor and offer values",
	}
	writeCartErrorWithCorrelation(response, fmt.Errorf("upsert cart line: %w", databaseErr), "cart-correlation-123")

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
	if !strings.Contains(response.Body.String(), `"code":"DSH_STORAGE_UNAVAILABLE"`) {
		t.Fatalf("response did not preserve the generic storage error contract: %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), "private actor") || strings.Contains(response.Body.String(), "commerce_cart_lines_offer_fk") {
		t.Fatalf("response exposed persistence diagnostics: %s", response.Body.String())
	}
	for _, expected := range []string{"cart persistence failure", `correlation_id="cart-correlation-123"`, `sqlstate="23503"`, `schema="dsh"`, `table="commerce_cart_lines"`, `constraint="commerce_cart_lines_offer_fk"`} {
		if !strings.Contains(output.String(), expected) {
			t.Errorf("log output missing %q: %s", expected, output.String())
		}
	}
	if strings.Contains(output.String(), "private actor") {
		t.Fatalf("persistence diagnostic exposed row details: %s", output.String())
	}
}

func TestWriteCartErrorDoesNotLogKnownClientErrors(t *testing.T) {
	previousOutput := log.Writer()
	var output bytes.Buffer
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previousOutput) })

	response := httptest.NewRecorder()
	writeCartErrorWithCorrelation(response, postgres.ErrCartQuantityInvalid, "cart-correlation-456")

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if output.Len() != 0 {
		t.Fatalf("known client failure should not emit an internal diagnostic: %s", output.String())
	}
}
