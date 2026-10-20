package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

// A forged actor header or a client token must never authorize platform policy
// changes or Operations cancellation. All denials precede service execution.
func TestCancellationMutationRoutesRejectUntrustedCaller(t *testing.T) {
	const secret = "secret-cancellation-service-token-12345"
	verifier, err := auth.NewServiceToken(secret)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	(&OrderServer{auth: verifier}).Register(mux)
	(&CatalogServer{auth: verifier}).Register(mux)
	for _, c := range []struct {
		name, method, path, token string
		forge                     bool
		status                    int
	}{
		{"customer cannot modify type policy", "PATCH", "/dsh/operator/cancellation-policies/store-type-1", "customer-access-token", false, http.StatusUnauthorized},
		{"anonymous cannot modify type policy", "PATCH", "/dsh/operator/cancellation-policies/store-type-1", "", false, http.StatusUnauthorized},
		{"forged customer actor cannot modify type policy", "PATCH", "/dsh/operator/cancellation-policies/store-type-1", secret, true, http.StatusBadRequest},
		{"customer cannot operate cancellation", "POST", "/dsh/operator/operations/order-1/cancel", "customer-access-token", false, http.StatusUnauthorized},
		{"anonymous cannot operate cancellation", "POST", "/dsh/operator/operations/order-1/cancel", "", false, http.StatusUnauthorized},
		{"forged customer actor cannot operate cancellation", "POST", "/dsh/operator/operations/order-1/cancel", secret, true, http.StatusBadRequest},
	} {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, strings.NewReader("{}"))
			if c.token != "" {
				req.Header.Set("Authorization", "Bearer "+c.token)
			}
			if c.forge {
				req.Header.Set("X-Actor-ID", "forged-customer")
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != c.status {
				t.Fatalf("status=%d expected=%d body=%s", rec.Code, c.status, rec.Body.String())
			}
		})
	}
}
