package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStoreCatalogRegistrationHasNoJoiningCaseWriters(t *testing.T) {
	mux := newCatalogProductValidationMux(t)
	routes := []struct{ method, path string }{
		{"POST", "/dsh/field/catalog/identifiers/resolve"},
		{"GET", "/dsh/field/joining-cases/case-1/catalog"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/products"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/offers"},
		{"PATCH", "/dsh/field/joining-cases/case-1/catalog/offers/offer-1"},
		{"GET", "/dsh/field/joining-cases/case-1/catalog/quick-prices"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/quick-prices/commit"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/imports/preview"},
		{"GET", "/dsh/field/joining-cases/case-1/catalog/imports/run-1"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/imports/run-1/commit"},
		{"GET", "/dsh/field/joining-cases/case-1/catalog/product-proposals"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/product-proposals"},
		{"POST", "/dsh/field/joining-cases/case-1/catalog/product-proposals/proposal-1/submit"},
		{"PATCH", "/dsh/field/joining-cases/case-1/catalog/product-proposals/proposal-1"},
	}
	for _, tc := range routes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, nil)
			_, pattern := mux.Handler(request)
			if pattern != "" {
				t.Fatalf("retired route remains registered: %s", pattern)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusNotFound {
				t.Fatalf("retired route returned %d, want 404", response.Code)
			}
		})
	}
	for _, tc := range []struct{ method, path string }{
		{"POST", "/dsh/catalog/identifiers/resolve"},
		{"POST", "/dsh/stores/store-1/products"},
		{"POST", "/dsh/stores/store-1/offers"},
		{"POST", "/dsh/stores/store-1/catalog/imports/preview"},
		{"GET", "/dsh/stores/store-1/catalog/quick-prices"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		_, pattern := mux.Handler(req)
		if pattern == "" {
			t.Errorf("Partner Store catalog route disappeared: %s %s", tc.method, tc.path)
		}
	}
}
