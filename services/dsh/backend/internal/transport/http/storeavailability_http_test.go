package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPartnerStoreOperationalAvailabilityRequiresSessionBeforeStoreRead(t *testing.T) {
	server := &StoreAvailabilityServer{}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, method := range []string{http.MethodGet, http.MethodPatch} {
		request := httptest.NewRequest(method, "/dsh/partner/stores/store-1/operational-availability", nil)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated %s returned %d, want 401", method, response.Code)
		}
	}
}

func TestPublicStoreOrderabilityRequiresServiceCityScope(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/dsh/public/stores/store-1/orderability", nil)
	response := httptest.NewRecorder()
	(&StorePublicationServer{}).readPublicOrderability(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unscoped public orderability returned %d, want 400", response.Code)
	}
}
