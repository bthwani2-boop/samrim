package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestOwnFieldAcquisitionEntitlementsRequireFieldSession(t *testing.T) {
	authorizer, err := auth.NewServiceToken(strings.Repeat("s", 24))
	if err != nil {
		t.Fatalf("create DSH service authorizer: %v", err)
	}
	mux := http.NewServeMux()
	(&FieldFinanceServer{auth: authorizer}).Register(mux)
	request := httptest.NewRequest(http.MethodGet, "/dsh/fields/me/acquisition-entitlements", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: got %d, want %d; body=%s", response.Code, http.StatusUnauthorized, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
		t.Fatalf("unauthenticated response did not preserve the API error contract: %s", response.Body.String())
	}
}
