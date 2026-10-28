package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetiredFieldAndAcquisitionRoutesUnavailable(t *testing.T) {
	mux := http.NewServeMux()
	(&JoiningCaseServer{}).Register(mux)
	(&FieldFinanceServer{}).Register(mux)
	for _, route := range []struct{ method, path string }{
		{"POST", "/dsh/joining-cases/case-1/acquisition-attribution"},
		{"POST", "/dsh/fields/admissions"},
		{"GET", "/dsh/fields/me"},
		{"POST", "/dsh/operator/field-acquisition-reward-policies"},
		{"GET", "/dsh/operator/field-acquisition-reward-policies"},
		{"GET", "/dsh/fields/me/financial-summary"},
		{"GET", "/dsh/fields/me/acquisition-entitlements"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		_, pattern := mux.Handler(request)
		if pattern != "" {
			t.Errorf("retired route still registered: %s %s as %s", route.method, route.path, pattern)
		}
	}
	for _, route := range []struct{ method, path string }{
		{"GET", "/dsh/joining-cases/case-1"},
		{"POST", "/dsh/operator/partners/stores/store-1/commercial-agreements"},
		{"GET", "/dsh/operator/fields/actor-1/financial-summary"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		_, pattern := mux.Handler(request)
		if pattern == "" {
			t.Errorf("preserved route missing: %s %s", route.method, route.path)
		}
	}
}
