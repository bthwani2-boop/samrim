package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoreRelationCommercialDefaultRoutesRejectUnauthenticatedAndUnattributedMutations(t *testing.T) {
	server := &Server{serviceToken: "isolated-finance-service-token"}
	mux := http.NewServeMux()
	server.Register(mux)
	const path = "/wlt/v1/operator/store-relation-commercial-model-defaults"
	body := `{"relationModel":"INDEPENDENT_STORE","commercialModel":"SUBSCRIPTION","expectedVersion":0,"reason":"Prospective subscription requires Partner consent"}`
	for _, tc := range []struct {
		name       string
		method     string
		authorized bool
		actor      string
		keys       bool
		want       int
	}{
		{"read lacks service authorization", http.MethodGet, false, "", false, http.StatusUnauthorized},
		{"write lacks service authorization", http.MethodPost, false, "", false, http.StatusUnauthorized},
		{"write lacks idempotency and correlation keys", http.MethodPost, true, "operator-1", false, http.StatusBadRequest},
		{"write lacks authorized attributed actor", http.MethodPost, true, "", true, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, path, strings.NewReader(body))
			if tc.authorized {
				req.Header.Set("Authorization", "Bearer isolated-finance-service-token")
			}
			if tc.actor != "" {
				req.Header.Set("X-Acting-Actor-ID", tc.actor)
			}
			if tc.keys {
				req.Header.Set("Idempotency-Key", "model-policy-mutation-idempotency")
				req.Header.Set("X-Correlation-ID", "model-policy-mutation-correlation")
			}
			result := httptest.NewRecorder()
			mux.ServeHTTP(result, req)
			if result.Code != tc.want {
				t.Fatalf("status=%d want=%d response=%s", result.Code, tc.want, result.Body.String())
			}
		})
	}
}
