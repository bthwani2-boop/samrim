package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLegacyCODRecoveryRejectsUnauthorizedFinanceRequests(t *testing.T) {
	server := &Server{serviceToken: "isolated-finance-service-token"}
	for _, tc := range []struct {
		name    string
		method  string
		handler http.HandlerFunc
	}{
		{"submit", http.MethodPost, server.submitLegacyCODRecovery},
		{"read-review", http.MethodGet, server.readLegacyCODRecovery},
		{"read-by-payment", http.MethodGet, server.readLegacyCODRecoveryByPayment},
		{"approve", http.MethodPost, server.approveLegacyCODRecovery},
	} {
		t.Run(tc.name+"-missing-service-token", func(t *testing.T) {
			recorder := httptest.NewRecorder()
			tc.handler(recorder, httptest.NewRequest(tc.method, "/", nil))
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status=%d expected 401 body=%s", recorder.Code, recorder.Body.String())
			}
		})
		t.Run(tc.name+"-missing-operator-identity", func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/", nil)
			request.Header.Set("Authorization", "Bearer isolated-finance-service-token")
			recorder := httptest.NewRecorder()
			tc.handler(recorder, request)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status=%d expected 400 body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
