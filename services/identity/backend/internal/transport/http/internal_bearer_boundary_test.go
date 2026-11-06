package identityhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestInternalServiceBearerCannotBeReplacedByCallerHeaders verifies that only
// a configured bearer credential determines an internal service principal.
func TestInternalServiceBearerCannotBeReplacedByCallerHeaders(t *testing.T) {
	server := &Server{config: Config{InternalServiceTokens: map[string]string{
		"dsh":           "synthetic-dsh-service-secret",
		"control-panel": "synthetic-control-service-secret",
	}}}
	cases := []struct {
		name       string
		bearer     string
		wantStatus int
		wantCaller string
	}{
		{name: "missing bearer cannot spoof actor", wantStatus: http.StatusUnauthorized},
		{name: "human access token cannot call internal service", bearer: "human-session-access-not-a-service-token", wantStatus: http.StatusUnauthorized},
		{name: "wrong configured service secret", bearer: "synthetic-wlt-service-secret", wantStatus: http.StatusUnauthorized},
		{name: "valid dsh credential chooses dsh despite spoofed headers", bearer: "synthetic-dsh-service-secret", wantStatus: http.StatusNoContent, wantCaller: "dsh"},
		{name: "valid control credential chooses control-panel", bearer: "synthetic-control-service-secret", wantStatus: http.StatusNoContent, wantCaller: "control-panel"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			invocations := 0
			handler := server.internal(func(w http.ResponseWriter, _ *http.Request, caller string) {
				invocations++
				if caller != tc.wantCaller {
					t.Fatalf("service principal from bearer = %q; want %q", caller, tc.wantCaller)
				}
				w.WriteHeader(http.StatusNoContent)
			})
			request := httptest.NewRequest(http.MethodGet, "/internal/actors/synthetic-actor", nil)
			request.Header.Set("X-Actor-ID", "forged-actor")
			request.Header.Set("X-Acting-Actor-ID", "forged-operator")
			request.Header.Set("X-Service-Name", "control-panel")
			if tc.bearer != "" {
				request.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			response := httptest.NewRecorder()
			handler(response, request)
			if response.Code != tc.wantStatus {
				t.Fatalf("HTTP status = %d; want %d", response.Code, tc.wantStatus)
			}
			if tc.wantCaller == "" && invocations != 0 {
				t.Fatalf("unauthenticated service handler ran %d times", invocations)
			}
			if tc.wantCaller != "" && invocations != 1 {
				t.Fatalf("authenticated service handler ran %d times; want 1", invocations)
			}
		})
	}
}
