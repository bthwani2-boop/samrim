package discovery

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Reject unsupported or repeated public selectors before opening an owner
// transaction. Query aliases must never silently change Store/Offer scope.
func TestPublicStoreAndOfferQueriesRejectUnknownOrDuplicateSelectors(t *testing.T) {
	for _, tc := range []struct {
		name string
		path string
	}{
		{"store unknown", "/v1/public/stores?city_id=sanaa&actorId=someone"},
		{"store duplicate city", "/v1/public/stores?city_id=sanaa&city_id=aden"},
		{"store duplicate limit", "/v1/public/stores?city_id=sanaa&limit=1&limit=2"},
		{"store duplicate cursor", "/v1/public/stores?city_id=sanaa&cursor=one&cursor=two"},
		{"store alias", "/v1/public/stores?city_id=sanaa&category=grocery"},
		{"offer city override", "/v1/public/stores/store-a/offers?city_id=aden"},
		{"offer vertical override", "/v1/public/stores/store-a/offers?vertical_id=grocery"},
		{"offer duplicate limit", "/v1/public/stores/store-a/offers?limit=1&limit=2"},
		{"offer duplicate cursor", "/v1/public/stores/store-a/offers?cursor=one&cursor=two"},
		{"offer arbitrary", "/v1/public/stores/store-a/offers?actorId=other"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := httptest.NewRecorder()
			(&Server{Owner: &Owner{}}).ServeHTTP(writer,
				httptest.NewRequest(http.MethodGet, tc.path, nil))
			if writer.Code != http.StatusBadRequest ||
				!strings.Contains(writer.Body.String(), "INVALID_REQUEST") {
				t.Fatalf("unexpected selector reached owner: %s => %d %s",
					tc.path, writer.Code, writer.Body.String())
			}
		})
	}
}
