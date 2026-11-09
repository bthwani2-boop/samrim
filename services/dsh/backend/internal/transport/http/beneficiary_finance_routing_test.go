package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOperatorPayoutAndLegacyCODRoutesCoexist(t *testing.T) {
	mux := http.NewServeMux()
	// Exercise the real registration code from both owners, without
	// contacting Identity, WLT or the persistent database.
	(&OrderServer{}).Register(mux)
	(&BeneficiaryFinanceServer{}).Register(mux)
	for _, tc := range []struct {
		path    string
		pattern string
	}{
		{
			path:    "/dsh/operator/captain-cod-legacy-reviews/by-payment/payment-123",
			pattern: "GET /dsh/operator/captain-cod-legacy-reviews/by-payment/{paymentIntentId}",
		},
		{
			path:    "/dsh/operator/captain/actor-123/payout-state",
			pattern: "GET /dsh/operator/{actorType}/{actorId}/{financeAction...}",
		},
		{
			path:    "/dsh/operator/captain/actor-123/official-wallet-destination",
			pattern: "GET /dsh/operator/{actorType}/{actorId}/{financeAction...}",
		},
	} {
		_, actual := mux.Handler(httptest.NewRequest(http.MethodGet, tc.path, nil))
		if actual != tc.pattern {
			t.Errorf("route %s matched %q, want %q", tc.path, actual, tc.pattern)
		}
	}
}

func TestOperatorFinanceFallbackRejectsUnexpectedAction(t *testing.T) {
	s := &BeneficiaryFinanceServer{}
	for _, action := range []string{"orders", "payout-state/more", "payout"} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/operator/captain/actor-123/"+action, nil)
		request.SetPathValue("financeAction", action)
		response := httptest.NewRecorder()
		s.readOperatorPayoutStateRoute(response, request)
		if response.Code != http.StatusNotFound {
			t.Errorf("unsupported finance fallback %q returned %d", action, response.Code)
		}
	}
}
