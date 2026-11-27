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

func TestPublicDirectoriesRejectExplicitEmptyPagingSelectors(t *testing.T) {
	for _, path := range []string{
		"/v1/public/cities?limit=",
		"/v1/public/verticals?city_id=sanaa&limit=",
		"/v1/public/verticals?city_id=sanaa&cursor=",
		"/v1/public/stores?city_id=sanaa&limit=",
		"/v1/public/stores?city_id=sanaa&cursor=",
		"/v1/public/stores/store-a/offers?limit=",
		"/v1/public/stores/store-a/offers?cursor=",
	} {
		t.Run(path, func(t *testing.T) {
			writer := httptest.NewRecorder()
			(&Server{Owner: &Owner{}}).ServeHTTP(writer,
				httptest.NewRequest(http.MethodGet, path, nil))
			if writer.Code != http.StatusBadRequest {
				t.Fatalf("explicit empty paging value reached owner: %s => %d %s",
					path, writer.Code, writer.Body.String())
			}
		})
	}
}

func TestPublicReadsRejectUnsupportedRequestEnvelopes(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		chunked          bool
	}{
		{"detail unknown selector", "/v1/public/stores/store-a?actorId=other", "", false},
		{"detail empty query", "/v1/public/stores/store-a?", "", false},
		{"detail duplicate selector", "/v1/public/stores/store-a?city_id=a&city_id=b", "", false},
		{"cities body", "/v1/public/cities", "{}", false},
		{"verticals body", "/v1/public/verticals?city_id=sanaa", "{}", false},
		{"stores body", "/v1/public/stores?city_id=sanaa", "{}", false},
		{"detail body", "/v1/public/stores/store-a", "{}", false},
		{"offers body", "/v1/public/stores/store-a/offers", "{}", false},
		{"estimate body", "/v1/public/stores/store-a/offers/offer-a/estimate?quantity=1", "{}", false},
		{"chunked body", "/v1/public/stores/store-a", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.path, strings.NewReader(tc.body))
			if tc.chunked {
				r.ContentLength = -1
				r.TransferEncoding = []string{"chunked"}
			}
			w := httptest.NewRecorder()
			(&Server{}).ServeHTTP(w, r)
			if w.Code != http.StatusBadRequest || w.Body.String() != "{\"error\":\"INVALID_REQUEST\"}\n" {
				t.Fatalf("malformed public request reached owner: %d %s", w.Code, w.Body.String())
			}
		})
	}
	for _, path := range []string{
		"/v1/public/cities", "/v1/public/verticals?city_id=sanaa",
		"/v1/public/stores?city_id=sanaa", "/v1/public/stores/store-a",
		"/v1/public/stores/store-a/offers",
		"/v1/public/stores/store-a/offers/offer-a/estimate?quantity=1",
	} {
		w := httptest.NewRecorder()
		(&Server{}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("valid request failed to reach owner: %s => %d %s", path, w.Code, w.Body.String())
		}
	}
}
