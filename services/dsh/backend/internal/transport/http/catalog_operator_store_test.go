package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Operator Store catalog endpoints must be registered without bypassing service
// authentication or the acting-operator gate.
func TestOperatorStoreCatalogWriteBoundary(t *testing.T) {
	mux := newCatalogProductValidationMux(t)
	routes := []struct{ method, path string }{
		{"GET", "/dsh/operator/stores/store-one/products"},
		{"POST", "/dsh/operator/stores/store-one/products"},
		{"GET", "/dsh/operator/stores/store-one/products/product-one"},
		{"PATCH", "/dsh/operator/stores/store-one/products/product-one"},
		{"POST", "/dsh/operator/stores/store-one/products/product-one/media/upload"},
		{"GET", "/dsh/operator/stores/store-one/offers"},
		{"POST", "/dsh/operator/stores/store-one/offers"},
		{"PATCH", "/dsh/operator/stores/store-one/offers/offer-one"},
	}
	for _, c := range routes {
		t.Run(c.method+" "+c.path, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, nil)
			_, pattern := mux.Handler(req)
			if pattern == "" {
				t.Fatalf("missing canonical Store operation %s", c.path)
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("without service token: got %d want 401", rec.Code)
			}
			req = httptest.NewRequest(c.method, c.path, nil)
			req.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 24))
			rec = httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("without acting Operator: got %d want 400", rec.Code)
			}
		})
	}
}
