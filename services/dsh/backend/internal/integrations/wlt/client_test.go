package wlt

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveBaseURL(t *testing.T) {
	if value, err := ResolveBaseURL("", "development"); err != nil || value != "http://wlt:8083" {
		t.Fatalf("development default = %q, %v", value, err)
	}
	if _, err := ResolveBaseURL("http://wlt.example", "production"); err == nil {
		t.Fatal("production accepted an HTTP WLT endpoint")
	}
	if _, err := ResolveBaseURL("http://wlt.example", "unknown"); err == nil {
		t.Fatal("unknown environment was accepted")
	}
}

func TestCreateUsesServiceContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/wlt/v1/payment-intents" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("authorization header = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("Idempotency-Key") != "create-key" {
			t.Fatalf("idempotency header = %q", request.Header.Get("Idempotency-Key"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["currency"] != "YER" || body["method"] != methodCashOnDelivery || body["amountMinor"] != float64(1500) {
			t.Fatalf("unexpected payment body: %#v", body)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-1","state":"REQUIRES_COLLECTION","amountMinor":1500,"currency":"YER","method":"CASH_ON_DELIVERY"},"idempotentReplay":false}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	intent, replay, err := client.Create(t.Context(), "order-1", "client-1", 1500, "create-key", "corr-1")
	if err != nil {
		t.Fatal(err)
	}
	if replay || intent.ID != "pi-1" || intent.State != stateRequiresCollect {
		t.Fatalf("unexpected create result: %#v replay=%v", intent, replay)
	}
}

func TestCreateForOrderUsesRequestOnlyAllocationFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body struct {
			OrderID                   string `json:"orderId"`
			ExternalReference         string `json:"externalReference"`
			PayerActorID              string `json:"payerActorId"`
			AmountMinor               int64  `json:"amountMinor"`
			Currency                  string `json:"currency"`
			Method                    string `json:"method"`
			CustomerPaymentAllocation struct {
				OrderID                    string `json:"orderId"`
				StoreID                    string `json:"storeId"`
				PartnerActorID             string `json:"partnerActorId"`
				FulfillmentMode            string `json:"fulfillmentMode"`
				Currency                   string `json:"currency"`
				SubtotalMinor              int64  `json:"subtotalMinor"`
				DeliveryFeeMinor           int64  `json:"deliveryFeeMinor"`
				DiscountMinor              int64  `json:"discountMinor"`
				InternalBalanceAmountMinor int64  `json:"internalBalanceAmountMinor"`
				CashAmountMinor            int64  `json:"cashAmountMinor"`
				CustomerPayableMinor       int64  `json:"customerPayableMinor"`
				PolicyVersion              string `json:"policyVersion"`
			} `json:"customerPaymentAllocation"`
		}
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			t.Fatalf("request did not match WLT create contract: %v", err)
		}
		allocation := body.CustomerPaymentAllocation
		if body.OrderID != "order-1" || body.AmountMinor != 1300 || body.Method != methodCashOnDelivery || allocation.OrderID != body.OrderID || allocation.StoreID != "store-1" || allocation.PartnerActorID != "partner-1" || allocation.SubtotalMinor != 1300 || allocation.CashAmountMinor != 1300 || allocation.CustomerPayableMinor != 1300 {
			t.Fatalf("unexpected create-for-order body: %#v", body)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-order-1","state":"REQUIRES_COLLECTION","amountMinor":1300,"currency":"YER","method":"CASH_ON_DELIVERY"},"idempotentReplay":false}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	allocation := CustomerPaymentAllocation{ID: "allocation-response-only", OrderID: "order-1", StoreID: "store-1", PartnerActorID: "partner-1", FulfillmentMode: "BTHWANI_CAPTAIN", Currency: "YER", SubtotalMinor: 1300, CashAmountMinor: 1300, CustomerPayableMinor: 1300, PolicyVersion: "cod-current-v2", PaymentIntentID: "response-only", CreatedAt: "2026-09-28T00:00:00Z"}
	if _, _, err := client.CreateForOrderWithMethod(t.Context(), "order-1", "external-1", "client-1", 1300, methodCashOnDelivery, allocation, "create-order-key", "create-order-correlation"); err != nil {
		t.Fatalf("create order payment intent: %v", err)
	}
}

func TestListOperatorCashLiabilityUsesRegistryQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/wlt/v1/operator/cash-liability" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		query := request.URL.Query()
		if query.Get("search") != "cash-ref" || query.Get("sort") != "collected_desc" || query.Get("limit") != "25" || query.Get("cursor") != "opaque-cursor" {
			t.Fatalf("cash custody query = %#v", query)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"items":[],"totalAmountMinor":0,"totalItems":0,"limit":25}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.ListOperatorCashLiability(t.Context(), "cash-ref", "collected_desc", "opaque-cursor", 25)
	if err != nil || result.Limit != 25 || result.TotalItems != 0 {
		t.Fatalf("cash custody registry result = %#v, err=%v", result, err)
	}
}

func TestEnsureCollectedCollectsExactAmount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if request.Method == http.MethodGet {
			_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-1","state":"REQUIRES_COLLECTION","amountMinor":300,"currency":"YER","method":"CASH_ON_DELIVERY","version":1,"customerPaymentAllocation":{"orderId":"order-1","cashAmountMinor":300,"internalBalanceAmountMinor":1200,"customerPayableMinor":1500}}}`))
			return
		}
		if request.Method != http.MethodPost || request.URL.Path != "/wlt/v1/payment-intents/pi-1/collect" {
			t.Fatalf("unexpected collect request: %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("X-Expected-Version") != "1" {
			t.Fatalf("expected version = %q", request.Header.Get("X-Expected-Version"))
		}
		var body struct {
			CollectedAmountMinor int64  `json:"collectedAmountMinor"`
			CollectedByActorID   string `json:"collectedByActorId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.CollectedAmountMinor != 300 || body.CollectedByActorID != "captain-1" {
			t.Fatalf("collection body = %#v", body)
		}
		_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-1","state":"COLLECTED","amountMinor":300,"currency":"YER","method":"CASH_ON_DELIVERY","version":2,"collectedAmountMinor":300,"collectedByActorId":"captain-1","customerPaymentAllocation":{"orderId":"order-1","cashAmountMinor":300,"internalBalanceAmountMinor":1200,"customerPayableMinor":1500}}}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	intent, err := client.EnsureCollected(t.Context(), "pi-1", "captain-1", "cash-1", 1500, "collect-key", "corr-1")
	if err != nil {
		t.Fatal(err)
	}
	if intent.State != stateCollected || intent.AmountMinor != 300 {
		t.Fatalf("unexpected collected intent: %#v", intent)
	}
}

func TestEnsureCollectedSettlesFullBalanceWithoutCashActor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		if request.Method == http.MethodGet {
			_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-2","state":"REQUIRES_COLLECTION","amountMinor":0,"currency":"YER","method":"CASH_AT_STORE","version":1,"customerPaymentAllocation":{"orderId":"order-2","cashAmountMinor":0,"internalBalanceAmountMinor":900,"customerPayableMinor":900}}}`))
			return
		}
		if request.Method != http.MethodPost || request.URL.Path != "/wlt/v1/payment-intents/pi-2/collect" {
			t.Fatalf("unexpected balance settlement request: %s %s", request.Method, request.URL.Path)
		}
		var body struct {
			CollectedAmountMinor int64  `json:"collectedAmountMinor"`
			CollectedByActorID   string `json:"collectedByActorId"`
			CollectionReference  string `json:"collectionReference"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.CollectedAmountMinor != 0 || body.CollectedByActorID != "" || body.CollectionReference != "" {
			t.Fatalf("zero-cash settlement body = %#v", body)
		}
		_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-2","state":"COLLECTED","amountMinor":0,"currency":"YER","method":"CASH_AT_STORE","version":2,"collectedAmountMinor":0,"customerPaymentAllocation":{"orderId":"order-2","cashAmountMinor":0,"internalBalanceAmountMinor":900,"customerPayableMinor":900}}}`))
	}))
	defer server.Close()
	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	intent, err := client.EnsureCollected(t.Context(), "pi-2", "partner-1", "cash-reference", 900, "balance-settle-key", "balance-settle-corr")
	if err != nil {
		t.Fatal(err)
	}
	if intent.State != stateCollected || intent.CollectedByActorID != nil || intent.CollectedAmountMinor == nil || *intent.CollectedAmountMinor != 0 {
		t.Fatalf("unexpected balance-settled intent: %#v", intent)
	}
}
