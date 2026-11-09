package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

// A spoofed public or Partner caller must never mutate the independent
// publication; no Store data, actor roles or database are needed to reject it.
func TestIndependentSuspensionRejectsUntrustedCallerBeforeService(t *testing.T) {
	serviceToken, err := auth.NewServiceToken("a-long-control-panel-service-token-for-suspension")
	if err != nil {
		t.Fatal(err)
	}
	server := &StorePublicationServer{auth: serviceToken}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, tc := range []struct {
		name, token, acting string
		status              int
	}{
		{"unauthenticated", "", "", http.StatusUnauthorized},
		{"spoofed operator", "", "operator-a", http.StatusUnauthorized},
		{"untrusted token", "Bearer untrusted", "operator-a", http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/dsh/operator/independent-stores/private-store/suspend",
				strings.NewReader(`{"expectedVersion":1,"reason":"Suspected illegal product"}`))
			if tc.token != "" {
				req.Header.Set("Authorization", tc.token)
			}
			if tc.acting != "" {
				req.Header.Set("X-Acting-Actor-ID", tc.acting)
			}
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != tc.status {
				t.Fatalf("expected %d got %d body=%s", tc.status, res.Code, res.Body.String())
			}
			if res.Header().Get("Cache-Control") != "no-store" || res.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
				t.Fatalf("private operator response has unsafe headers: %+v", res.Header())
			}
			if strings.Contains(res.Body.String(), "private-store-owner") {
				t.Fatal("operator endpoint leaked private Store facts")
			}
		})
	}
}
