package wlt

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadByExternalReferenceUsesServiceBoundary(t *testing.T) {
	const externalReference = "dsh-checkout/ref + suffix"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/wlt/v1/payment-intents/by-external-reference" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		if request.URL.Query().Get("externalReference") != externalReference {
			t.Fatalf("externalReference query = %q", request.URL.Query().Get("externalReference"))
		}
		if request.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("authorization header = %q", request.Header.Get("Authorization"))
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"paymentIntent":{"id":"payment-1","externalReference":"dsh-checkout/ref + suffix","payerActorId":"client-1","method":"CASH_ON_DELIVERY","state":"REQUIRES_COLLECTION","customerPaymentAllocation":{"orderId":"order-1"}}}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "test", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	intent, err := client.ReadByExternalReference(t.Context(), externalReference)
	if err != nil {
		t.Fatal(err)
	}
	if intent.ID != "payment-1" || intent.ExternalReference != externalReference || intent.PayerActorID != "client-1" || intent.Method != "CASH_ON_DELIVERY" || intent.State != stateRequiresCollect || intent.CustomerPaymentAllocation == nil || intent.CustomerPaymentAllocation.OrderID != "order-1" {
		t.Fatalf("unexpected recovered payment: %#v", intent)
	}
}
