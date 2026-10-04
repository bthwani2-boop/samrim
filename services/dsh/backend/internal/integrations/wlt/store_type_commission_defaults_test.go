package wlt

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadStoreTypeCommissionDefaultsContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/wlt/v1/operator/commercial-store-type-commission-defaults" || r.URL.Query().Get("commercialStoreTypeId") != "type & one" {
			t.Errorf("commission defaults read request = %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("commission defaults read auth = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commercialStoreTypeId":"type & one","defaults":[{"commercialStoreTypeId":"type & one","fulfillmentMode":"PARTNER_CAPTAIN","suggestedCommissionRateBps":1250,"defaultVersion":3,"updatedAt":"2026-10-01T00:00:00Z","changedByActorId":"operator-1","changeReason":"terms review"}]}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.ReadStoreTypeCommissionDefaults(context.Background(), " type & one ")
	if err != nil || result.CommercialStoreTypeID != "type & one" || len(result.Defaults) != 1 || result.Defaults[0].SuggestedCommissionRateBps != 1250 || result.Defaults[0].DefaultVersion != 3 || result.Defaults[0].UpdatedAt != "2026-10-01T00:00:00Z" {
		t.Fatalf("commission defaults read result = %+v, error=%v", result, err)
	}
}

func TestUpdateStoreTypeCommissionDefaultContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/wlt/v1/operator/commercial-store-type-commission-defaults" {
			t.Errorf("commission default update request = %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Acting-Actor-ID") != "operator-1" || r.Header.Get("Idempotency-Key") != "default-key" || r.Header.Get("X-Correlation-ID") != "default-correlation" {
			t.Errorf("commission default mutation headers = %v", r.Header)
			http.Error(w, "mutation headers missing", http.StatusBadRequest)
			return
		}
		var body struct {
			CommercialStoreTypeID  string `json:"commercialStoreTypeId"`
			FulfillmentMode        string `json:"fulfillmentMode"`
			SuggestedRateBps       int    `json:"suggestedCommissionRateBps"`
			ExpectedDefaultVersion int    `json:"expectedDefaultVersion"`
			Reason                 string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode commission default update: %v", err)
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		want := struct {
			CommercialStoreTypeID  string `json:"commercialStoreTypeId"`
			FulfillmentMode        string `json:"fulfillmentMode"`
			SuggestedRateBps       int    `json:"suggestedCommissionRateBps"`
			ExpectedDefaultVersion int    `json:"expectedDefaultVersion"`
			Reason                 string `json:"reason"`
		}{"type-1", "PARTNER_CAPTAIN", 1750, 2, "updated suggestion"}
		if body != want {
			t.Errorf("commission default update body = %+v", body)
			http.Error(w, "commission default body changed", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"default":{"commercialStoreTypeId":"type-1","fulfillmentMode":"PARTNER_CAPTAIN","suggestedCommissionRateBps":1750,"defaultVersion":3,"updatedAt":"2026-10-02T00:00:00Z"},"idempotentReplay":false}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.UpdateStoreTypeCommissionDefault(context.Background(), StoreTypeCommissionDefaultUpdateInput{
		CommercialStoreTypeID: " type-1 ", FulfillmentMode: " PARTNER_CAPTAIN ", SuggestedCommissionRateBps: 1750,
		ExpectedDefaultVersion: 2, Reason: " updated suggestion ", IdempotencyKey: "default-key",
		CorrelationID: "default-correlation", ActingActorID: "operator-1",
	})
	if err != nil || result.Default.CommercialStoreTypeID != "type-1" || result.Default.DefaultVersion != 3 || result.IdempotentReplay {
		t.Fatalf("commission default update result = %+v, error=%v", result, err)
	}
}
