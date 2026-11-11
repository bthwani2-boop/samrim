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

func TestRelationCommercialModelDefaultRoutesRequireServiceAuthAndActor(t *testing.T) {
	const token = "authorized-dsh-service-token-isolated"
	authz, err := auth.NewServiceToken(token)
	if err != nil {
		t.Fatal(err)
	}
	server := &JoiningCaseServer{auth: authz}
	mux := http.NewServeMux()
	server.RegisterStoreCommercialAgreementRoutes(mux)
	const path = "/dsh/operator/store-relation-commercial-model-defaults"
	for _, tc := range []struct {
		name         string
		method       string
		serviceToken bool
		expected     int
	}{
		{"read without service token", http.MethodGet, false, http.StatusUnauthorized},
		{"write without service token", http.MethodPost, false, http.StatusUnauthorized},
		{"read without an attributed actor", http.MethodGet, true, http.StatusBadRequest},
		{"write without an attributed actor", http.MethodPost, true, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, path, strings.NewReader("{}"))
			if tc.serviceToken {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, req)
			if response.Code != tc.expected {
				t.Fatalf("relation model policy endpoint status=%d, want %d, body=%s", response.Code, tc.expected, response.Body.String())
			}
		})
	}
}
