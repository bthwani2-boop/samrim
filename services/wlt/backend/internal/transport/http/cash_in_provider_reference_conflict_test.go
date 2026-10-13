package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func TestCashInProviderReferenceCollisionReturnsConflict(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeCashInError(recorder, postgres.ErrFundingProviderReferenceUsed)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("provider reference collision HTTP status=%d, want 409", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "PROVIDER_REFERENCE_CONFLICT") {
		t.Fatalf("provider reference collision API body=%q does not identify conflict", recorder.Body.String())
	}
}
