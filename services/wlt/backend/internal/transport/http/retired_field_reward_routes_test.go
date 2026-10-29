package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetiredFieldRewardWritersHaveNoRoutes(t *testing.T) {
	mux := http.NewServeMux()
	(&Server{}).Register(mux)
	for _, route := range []struct{ method, path string }{
		{"POST", "/wlt/v1/field-acquisition-entitlements/finalize"},
		{"POST", "/wlt/v1/operator/field-acquisition-reward-policies"},
		{"GET", "/wlt/v1/operator/field-acquisition-reward-policies"},
		{"GET", "/wlt/v1/field-acquisition-entitlements/legacy-case"},
		{"GET", "/wlt/v1/fields/legacy-actor/financial-summary"},
		{"GET", "/wlt/v1/fields/legacy-actor/wallet-history"},
		{"GET", "/wlt/v1/fields/legacy-actor/payout-requests"},
		{"GET", "/wlt/v1/fields/legacy-actor/acquisition-entitlements"},
		{"POST", "/wlt/v1/operator/field-payout-states:batch"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		_, pattern := mux.Handler(request)
		if pattern != "" {
			t.Fatalf("retired Field writer still registered: %s %s -> %s", route.method, route.path, pattern)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/wlt/v1/operator/beneficiaries/field/legacy-actor/financial-statement", nil)
	_, pattern := mux.Handler(request)
	if pattern == "" {
		t.Fatal("canonical audit statement route disappeared")
	}
}
