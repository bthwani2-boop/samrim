package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestOperatorLegacyCODRecoveryRejectsUnauthenticatedOrForgedActors(t *testing.T) {
	token, err := auth.NewServiceToken("isolated-finance-service-token")
	if err != nil {
		t.Fatal(err)
	}
	server := &OrderServer{auth: token}
	for _, tc := range []struct {
		name    string
		method  string
		handler http.HandlerFunc
	}{
		{"submit", http.MethodPost, server.submitOperatorLegacyCODRecovery},
		{"read", http.MethodGet, server.readOperatorLegacyCODRecoveryByPayment},
		{"approve", http.MethodPost, server.approveOperatorLegacyCODRecovery},
	} {
		t.Run(tc.name+"-unauthenticated", func(t *testing.T) {
			recorder := httptest.NewRecorder()
			tc.handler(recorder, httptest.NewRequest(tc.method, "/", nil))
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401 got %d body=%s", recorder.Code, recorder.Body.String())
			}
		})
		t.Run(tc.name+"-forged-client-actor", func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/", nil)
			request.Header.Set("Authorization", "Bearer isolated-finance-service-token")
			request.Header.Set("X-Acting-Actor-ID", "operator-finance")
			request.Header.Set("X-Actor-ID", "forged-customer")
			recorder := httptest.NewRecorder()
			tc.handler(recorder, request)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 got %d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
