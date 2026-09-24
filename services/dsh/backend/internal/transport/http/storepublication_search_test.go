package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSearchPublicCatalogValidatesUnicodeQueryAndCursorLength(t *testing.T) {
	testRequest := func(query, cursor string) int {
		values := url.Values{"serviceCityId": {"city-1"}, "q": {query}}
		if cursor != "" {
			values.Set("cursor", cursor)
		}
		request := httptest.NewRequest(http.MethodGet, "/dsh/public/catalog/search?"+values.Encode(), nil)
		response := httptest.NewRecorder()
		(&StorePublicationServer{}).searchPublicCatalog(response, request)
		return response.Code
	}

	if got := testRequest(strings.Repeat("ع", 160), ""); got == http.StatusBadRequest {
		t.Fatal("a query of 160 Arabic characters must pass request validation")
	}
	if got := testRequest(strings.Repeat("ع", 161), ""); got != http.StatusBadRequest {
		t.Fatalf("161 Arabic characters returned status %d, want 400", got)
	}
	if got := testRequest("قهوة", strings.Repeat("a", 1024)); got == http.StatusBadRequest {
		t.Fatal("a 1024-character cursor must pass request validation")
	}
	if got := testRequest("قهوة", strings.Repeat("a", 1025)); got != http.StatusBadRequest {
		t.Fatalf("1025 cursor characters returned status %d, want 400", got)
	}
}
