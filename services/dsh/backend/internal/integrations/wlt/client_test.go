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
			_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-1","state":"REQUIRES_COLLECTION","amountMinor":1500,"currency":"YER","method":"CASH_ON_DELIVERY","version":1}}`))
			return
		}
		if request.Method != http.MethodPost || request.URL.Path != "/wlt/v1/payment-intents/pi-1/collect" {
			t.Fatalf("unexpected collect request: %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("X-Expected-Version") != "1" {
			t.Fatalf("expected version = %q", request.Header.Get("X-Expected-Version"))
		}
		_, _ = response.Write([]byte(`{"paymentIntent":{"id":"pi-1","state":"COLLECTED","amountMinor":1500,"currency":"YER","method":"CASH_ON_DELIVERY","version":2}}`))
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
	if intent.State != stateCollected || intent.AmountMinor != 1500 {
		t.Fatalf("unexpected collected intent: %#v", intent)
	}
}
