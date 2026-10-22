package wlt

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnsureCollectedRejectsWrongPaymentMethodBeforeCollection(t *testing.T) {
	for _, tc := range []struct {
		name, actual, expected, state string
	}{
		{"captain cannot collect store cash", MethodCashAtStore, MethodCashOnDelivery, stateRequiresCollect},
		{"store cannot collect captain COD", MethodCashOnDelivery, MethodCashAtStore, stateRequiresCollect},
		{"replayed collected intent still needs correct mode", MethodCashAtStore, MethodCashOnDelivery, stateCollected},
	} {
		t.Run(tc.name, func(t *testing.T) {
			collectCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodGet {
					collectCalls++
					http.Error(response, "collection must not happen", http.StatusBadRequest)
					return
				}
				response.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(response).Encode(map[string]any{"paymentIntent": map[string]any{
					"id": "wrong-mode", "state": tc.state, "amountMinor": 300, "currency": "YER",
					"method": tc.actual, "version": 1, "collectedAmountMinor": 300,
					"collectedByActorId": "collector-1",
					"customerPaymentAllocation": map[string]any{
						"orderId": "order-1", "cashAmountMinor": 300, "customerPayableMinor": 300,
						"internalBalanceAmountMinor": 0,
					},
				}})
			}))
			defer server.Close()
			client, err := New(server.URL, "development", "test-token")
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.EnsureCollected(t.Context(), "wrong-mode", tc.expected,
				"collector-1", "test-ref", 300, "wrong-mode-key", "wrong-mode-correlation")
			var financeErr *Error
			if !errors.As(err, &financeErr) || financeErr.Code != "PAYMENT_METHOD_MISMATCH" {
				t.Fatalf("wrong payment method must fail with PAYMENT_METHOD_MISMATCH, got %v", err)
			}
			if collectCalls != 0 {
				t.Fatalf("incorrect payment method changed WLT state: collect calls=%d", collectCalls)
			}
		})
	}
}
