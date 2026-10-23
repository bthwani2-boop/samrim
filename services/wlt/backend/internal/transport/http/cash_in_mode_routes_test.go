package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/cashin"
)

// The external provider emulator supports Cash-In only. An Android client must
// never be able to choose its outcome, and mock availability must not create a
// synthetic payout or withdrawal route.
func TestCashInRailRoutesEnforceProviderBoundary(t *testing.T) {
	rail, err := cashin.NewWireMockRail("http://payment-mock:8080")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name            string
		server          Server
		manualStatus    int
		reconcileStatus int
	}{
		{"provider-backed", Server{cashInRail: rail, cashInSimulatorEnabled: true}, http.StatusNotFound, http.StatusUnauthorized},
		{"legacy-manual-test", Server{cashInRail: cashin.DevelopmentSimulator{}, cashInSimulatorEnabled: true}, http.StatusUnauthorized, http.StatusNotFound},
		{"no-provider", Server{}, http.StatusNotFound, http.StatusNotFound},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			mux := http.NewServeMux()
			test.server.Register(mux)
			for _, check := range []struct {
				method, path string
				want         int
			}{
				{"POST", "/wlt/v1/development/funding-intents/funding_test/simulate", test.manualStatus},
				{"POST", "/wlt/v1/development/funding-intents/funding_test/reconcile", test.reconcileStatus},
				{"POST", "/wlt/v1/providers/wallet_provider_test_alpha/payouts", http.StatusNotFound},
				{"POST", "/wlt/v1/providers/wallet_provider_test_alpha/cash-out", http.StatusNotFound},
			} {
				recorder := httptest.NewRecorder()
				mux.ServeHTTP(recorder, httptest.NewRequest(check.method, check.path, nil))
				if recorder.Code != check.want {
					t.Fatalf("%s %s status=%d want=%d body=%s", check.method, check.path, recorder.Code, check.want, recorder.Body.String())
				}
			}
		})
	}
}
