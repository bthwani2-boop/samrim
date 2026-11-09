package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// No second Order writer or transition API may be revived per commercial model.
// Partner order management uses the existing /dsh/partner/orders route.
func TestRetiredIndependentOrderRoutesAreNotRegistered(t *testing.T) {
	mux := http.NewServeMux()
	(&OrderServer{}).Register(mux)
	for _, tc := range []struct{ method, path string }{
		{"GET", "/dsh/partner/stores/store-a/direct-orders"},
		{"PATCH", "/dsh/partner/stores/store-a/direct-orders/order-a"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("retired Order route %s %s remains active: status=%d", tc.method, tc.path, rec.Code)
		}
	}
}
