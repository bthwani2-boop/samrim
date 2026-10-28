package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPartnersStoreAgreementRoutesRequireServiceAuth(t *testing.T) {
	authz, err := auth.NewServiceToken(strings.Repeat("t", 24))
	if err != nil {
		t.Fatal(err)
	}
	server := &JoiningCaseServer{auth: authz}
	mux := http.NewServeMux()
	server.RegisterStoreCommercialAgreementRoutes(mux)
	for _, method := range []string{"GET", "POST"} {
		req := httptest.NewRequest(method, "/dsh/operator/partners/stores/example/commercial-agreements", nil)
		req.Header.Set("X-Acting-Actor-ID", "operator-fake")
		req.Header.Set("X-Correlation-ID", "correlation-test")
		req.Header.Set("Idempotency-Key", "idempotency-test")
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, req)
		if resp.Code != http.StatusUnauthorized || !strings.Contains(resp.Body.String(), "UNAUTHENTICATED") {
			t.Fatalf("%s unauthorized status=%d body=%s", method, resp.Code, resp.Body.String())
		}
	}
}
