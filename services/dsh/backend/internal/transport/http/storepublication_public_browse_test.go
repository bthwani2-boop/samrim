package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicCatalogBrowseAcceptsEmptyQuery(t *testing.T) {
	server := &StorePublicationServer{}
	request := httptest.NewRequest(http.MethodGet, "/dsh/public/catalog/search?serviceCityId=city-test&limit=18", nil)
	response := httptest.NewRecorder()

	server.searchPublicCatalog(response, request)

	// A valid query reaches service availability validation; an empty q is not an error.
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("empty query should be accepted as a bounded browse request; status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestPublicCatalogBrowsePriceSortValidation(t *testing.T) {
	server := &StorePublicationServer{}
	for _, value := range []string{"PRICE_ASC", "PRICE_DESC"} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/public/catalog/search?serviceCityId=city-test&sort="+value, nil)
		response := httptest.NewRecorder()
		server.searchPublicCatalog(response, request)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s should pass input validation; status=%d body=%s", value, response.Code, response.Body.String())
		}
	}
	for _, value := range []string{"price_asc", "PRICE_RANDOM", "unknown"} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/public/catalog/search?serviceCityId=city-test&sort="+value, nil)
		response := httptest.NewRecorder()
		server.searchPublicCatalog(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid sort %s should be rejected; status=%d body=%s", value, response.Code, response.Body.String())
		}
	}
}
