package discovery

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOwnerBackedOfferEstimate(t *testing.T) {
	owner, handler := setupIntegratedOwner(t)
	server := httptest.NewServer(handler)
	defer server.Close()
	const route = "/v1/public/stores/market-sanaa/offers/of-flour/estimate"
	read := func(path string, status int, target any) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, server.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != status || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: response status=%d, cache=%q", path, resp.StatusCode, resp.Header.Get("Cache-Control"))
		}
		if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
			t.Fatal(err)
		}
	}
	var got offerEstimate
	read(route+"?quantity=2", 200, &got)
	if want := (offerEstimate{"market-sanaa", "of-flour", "v-p-flour", 2, "1200", "2400"}); got != want {
		t.Fatalf("wrong current DSH estimate: %+v", got)
	}
	for _, tc := range []struct {
		path   string
		status int
		code   string
	}{
		{route + "?quantity=10", 409, "INSUFFICIENT_AVAILABLE_QUANTITY"},
		{route + "?quantity=0", 400, "INVALID_REQUEST"},
		{route + "?quantity=02", 400, "INVALID_REQUEST"},
		{route + "?quantity=2147483648", 400, "INVALID_REQUEST"},
		{route + "?quantity=2&quantity=3", 400, "INVALID_REQUEST"},
		{route + "?quantity=2&price=1", 400, "INVALID_REQUEST"},
		{"/v1/public/stores/direct-sanaa/offers/of-flour/estimate?quantity=1", 404, "NOT_FOUND"},
		{"/v1/public/stores/market-sanaa/offers/of-draft/estimate?quantity=1", 404, "NOT_FOUND"},
		{"/v1/public/stores/market-sanaa/offers/of-empty/estimate?quantity=1", 404, "NOT_FOUND"},
	} {
		var body map[string]string
		read(tc.path, tc.status, &body)
		if len(body) != 1 || body["error"] != tc.code {
			t.Fatalf("%s: unexpected response %v", tc.path, body)
		}
	}
	var stock int
	if err := owner.DB.QueryRowContext(t.Context(), "SELECT stock_units FROM "+owner.Schema+
		".offers WHERE id='of-flour'").Scan(&stock); err != nil || stock != 9 {
		t.Fatalf("estimate changed stock: %d %v", stock, err)
	}
	if _, err := owner.DB.ExecContext(t.Context(), "UPDATE "+owner.Schema+
		".offers SET price_yer=9223372036854775807,stock_units=2 WHERE id='of-flour'"); err != nil {
		t.Fatal(err)
	}
	read(route+"?quantity=2", 200, &got)
	if got.UnitYER != "9223372036854775807" || got.SubtotalYER != "18446744073709551614" {
		t.Fatalf("stale or rounded price: %+v", got)
	}
	var unavailable map[string]string
	read(route+"?quantity=3", 409, &unavailable)
	if _, err := owner.DB.ExecContext(t.Context(), "UPDATE "+owner.Schema+
		".stores SET published=false WHERE id='market-sanaa'"); err != nil {
		t.Fatal(err)
	}
	var hidden map[string]string
	read(route+"?quantity=1", 404, &hidden)
	if len(hidden) != 1 || hidden["error"] != "NOT_FOUND" {
		t.Fatalf("unpublished Store disclosed an estimate: %v", hidden)
	}
}
