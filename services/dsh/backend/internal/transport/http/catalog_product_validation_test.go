package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func newCatalogProductValidationMux(t *testing.T) *http.ServeMux {
	t.Helper()
	serviceAuth, err := auth.NewServiceToken(strings.Repeat("s", 24))
	if err != nil {
		t.Fatalf("create DSH test authorizer: %v", err)
	}
	mux := http.NewServeMux()
	(&CatalogServer{auth: serviceAuth}).Register(mux)
	return mux
}

func TestCatalogProductHandlersRejectInvalidFiltersBeforeReading(t *testing.T) {
	mux := newCatalogProductValidationMux(t)
	cases := []struct {
		name string
		path string
	}{
		{name: "product cursor too long", path: "/dsh/catalog/products?cursor=" + strings.Repeat("c", 2049)},
		{name: "product limit too high", path: "/dsh/catalog/products?limit=101"},
		{name: "registry search too long", path: "/dsh/catalog/product-registry?q=" + strings.Repeat("q", 161)},
		{name: "registry category too long", path: "/dsh/catalog/product-registry?categoryId=" + strings.Repeat("c", 129)},
		{name: "registry cursor too long", path: "/dsh/catalog/product-registry?cursor=" + strings.Repeat("c", 2049)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tc.path, nil)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
				t.Fatalf("invalid catalog filter response: got %d, body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestCatalogProductMutationRequiresActorAndTypedAttributeSets(t *testing.T) {
	mux := newCatalogProductValidationMux(t)
	requests := []struct {
		name   string
		method string
		path   string
		body   string
		header bool
	}{
		{name: "create requires mutation authority", method: http.MethodPost, path: "/dsh/catalog/products", body: `{"verticalId":"vertical-1"}`},
		{name: "update requires complete typed attribute sets", method: http.MethodPatch, path: "/dsh/catalog/products/product-1", body: `{"categoryIds":[]}`, header: true},
	}
	for _, tc := range requests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 24))
			if tc.header {
				request.Header.Set("X-Acting-Actor-ID", "operator")
				request.Header.Set("X-Correlation-ID", "correlation-1")
				request.Header.Set("Idempotency-Key", "idempotency-1")
				request.Header.Set("X-Expected-Version", "1")
			}
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
				t.Fatalf("invalid catalog mutation response: got %d, body=%s", response.Code, response.Body.String())
			}
		})
	}
}
