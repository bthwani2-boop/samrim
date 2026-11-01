package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPartnerOrderSummaryRouteRejectsUntrustedRequestsBeforeReadingData(t *testing.T) {
	server := &OrderServer{}
	mux := http.NewServeMux()
	server.Register(mux)

	unauthenticated := httptest.NewRecorder()
	mux.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet,
		"/dsh/partner/stores/owned-store/orders/summary?period=30d", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("missing Partner token: status=%d, want %d", unauthenticated.Code, http.StatusUnauthorized)
	}

	for _, invalid := range []string{"month", "7days", "ALL", "0"} {
		request := httptest.NewRequest(http.MethodGet,
			"/dsh/partner/stores/owned-store/orders/summary?period="+invalid, nil)
		request.Header.Set("Authorization", "Bearer unverified-test")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("period %q returned status=%d, want %d", invalid, response.Code, http.StatusBadRequest)
		}
	}
}
