package wallet

import (
	"context"
	"net/http/httptest"
	"testing"
)

func TestAllocationReadbackRejectsUnauthorizedAndInvalidRequests(t *testing.T) {
	h, err := newHandler("http://127.0.0.1:1", func(context.Context, string) (walletAmounts, error) {
		t.Fatal("invalid request reached owner")
		return walletAmounts{}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/v1/wallets/me/order-payment-allocations/checkout-0001", 401},
		{"GET", "/v1/wallets/me/order-payment-allocations/short", 400},
		{"GET", "/v1/wallets/me/order-payment-allocations/checkout-0001?actorId=other", 400},
		{"POST", "/v1/wallets/me/order-payment-allocations/checkout-0001", 405},
	} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(tc.method, tc.path, nil))
		if r.Code != tc.status {
			t.Errorf("%s %s: got %d want %d", tc.method, tc.path, r.Code, tc.status)
		}
	}
}
