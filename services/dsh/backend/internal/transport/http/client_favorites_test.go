package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFavoriteStoreOfferEndpointsRequireClientSession(t *testing.T) {
	server := &ClientFavoritesServer{}
	mux := http.NewServeMux()
	server.Register(mux)

	requests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "list favorite offers", method: http.MethodGet, path: "/dsh/client/favorite-store-offers?storeId=store-1"},
		{name: "add favorite offer", method: http.MethodPut, path: "/dsh/client/favorite-store-offers/offer-1"},
		{name: "remove favorite offer", method: http.MethodDelete, path: "/dsh/client/favorite-store-offers/offer-1"},
		{name: "read favorite catalog", method: http.MethodGet, path: "/dsh/client/favorite-store-catalog?storeId=store-1&serviceCityId=city-1"},
	}
	for _, test := range requests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusUnauthorized, response.Body.String())
			}
		})
	}
}
