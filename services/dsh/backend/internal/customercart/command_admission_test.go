package customercart

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCustomerCommandAdmission(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	handler, err := NewHandler(db, "dsh_test_commands", cartSessionAdapter{&testSession{}})
	if err != nil {
		t.Fatal(err)
	}
	const cart = `{"operationId":"cart-op-0001","expectedVersion":0,"lines":[{"offerId":"offer-a","quantity":2}]}`
	const address = `{"cityId":"sanaa","label":"بيت","details":"عنوان","latitude":15.3,"longitude":44.2,"expectedVersion":0}`
	const favorite = `{"favorite":false}`
	const checkout = `{"expectedCartVersion":1,"salesChannel":"DIRECT","recipientPurpose":"SELF","fulfillmentMode":"CUSTOMER_PICKUP"}`

	routes := []struct {
		name, method, path, body string
	}{
		{"cart", "PUT", "/v1/carts/store-a", cart},
		{"address", "PUT", "/v1/addresses/" + addressID, address},
		{"favorite", "PUT", "/v1/customers/me/favorite-stores/store-a", favorite},
		{"checkout", "POST", "/v1/carts/store-a/checkout-review", checkout},
	}
	for _, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			for _, tc := range []struct {
				name            string
				media, encoding []string
				origin, site    string
			}{
				{"duplicate media", []string{"application/json", "application/json"}, nil, "", ""},
				{"non-UTF8", []string{"application/json; charset=iso-8859-1"}, nil, "", ""},
				{"unexpected media parameter", []string{"application/json; profile=other"}, nil, "", ""},
				{"ambiguous encoding", []string{"application/json"}, []string{"", "gzip"}, "", ""},
				{"cross origin", []string{"application/json"}, nil, "https://other.invalid", ""},
				{"cross site", []string{"application/json"}, nil, "", "cross-site"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					req := httptest.NewRequest(route.method, route.path, strings.NewReader(route.body))
					for _, media := range tc.media {
						req.Header.Add("Content-Type", media)
					}
					for _, encoding := range tc.encoding {
						req.Header.Add("Content-Encoding", encoding)
					}
					if tc.origin != "" {
						req.Header.Set("Origin", tc.origin)
					}
					if tc.site != "" {
						req.Header.Set("Sec-Fetch-Site", tc.site)
					}
					// Address validates Identity before command decoding; use its existing test actor.
					if route.name == "address" {
						req.Header.Set("Authorization", "Bearer "+cartTestBearer("customer-a"))
					}
					w := httptest.NewRecorder()
					handler.ServeHTTP(w, req)
					if w.Code != http.StatusBadRequest {
						t.Fatalf("ambiguous envelope admitted: %d", w.Code)
					}
				})
			}
		})
	}
	for _, body := range []string{
		strings.Replace(cart, "{", `{"operationId":"cart-other-001",`, 1),
		strings.Replace(cart, "expectedVersion", "ExpectedVersion", 1),
		strings.Replace(cart, `"quantity":2`, `"quantity":1,"quantity":2`, 1),
		strings.Replace(cart, `"quantity":2`, `"Quantity":2`, 1),
		strings.Replace(cart, `"expectedVersion":0`, `"expectedVersion":9007199254740991`, 1),
	} {
		req := httptest.NewRequest("PUT", "/v1/carts/store-a", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Errorf("ambiguous cart command admitted: %d", w.Code)
		}
	}
	for _, body := range []string{
		strings.Replace(address, "بيت", `\ud800`, 1),
		strings.Replace(address, "عنوان", `\udfff`, 1),
	} {
		req := httptest.NewRequest("PUT", "/v1/addresses/"+addressID, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if _, ok := decodeAddressChange(httptest.NewRecorder(), req); ok {
			t.Error("malformed Unicode address admitted")
		}
	}
}
