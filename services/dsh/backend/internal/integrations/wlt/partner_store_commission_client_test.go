package wlt

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadPartnerStoreCommissionPoliciesContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/wlt/v1/operator/commercial-store-type-commission-policies" || r.URL.Query().Get("commercialStoreTypeId") != "type & one" {
			t.Errorf("commission policy read request = %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commercialStoreTypeId":"type & one","policies":[{"commercialStoreTypeId":"type & one","fulfillmentMode":"PARTNER_CAPTAIN","commissionRateBps":1250,"policyVersion":3,"updatedAt":"2026-10-01T00:00:00Z","changedByActorId":"operator-1","changeReason":"terms review"}]}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.ReadPartnerStoreCommissionPolicies(context.Background(), " type & one ")
	if err != nil || result.CommercialStoreTypeID != "type & one" || len(result.Policies) != 1 || result.Policies[0].CommissionRateBps != 1250 || result.Policies[0].ChangedByActorID != "operator-1" {
		t.Fatalf("commission policy read result = %+v, error=%v", result, err)
	}
}

func TestUpdatePartnerStoreCommissionPolicyContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/wlt/v1/operator/commercial-store-type-commission-policies" {
			t.Errorf("commission policy update request = %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Acting-Actor-ID") != "operator-1" || r.Header.Get("Idempotency-Key") != "commission-key" || r.Header.Get("X-Correlation-ID") != "commission-correlation" {
			t.Errorf("commission policy mutation headers = %v", r.Header)
			http.Error(w, "mutation headers missing", http.StatusBadRequest)
			return
		}
		var body struct {
			CommercialStoreTypeID string `json:"commercialStoreTypeId"`
			FulfillmentMode       string `json:"fulfillmentMode"`
			CommissionRateBps     int    `json:"commissionRateBps"`
			ExpectedVersion       int    `json:"expectedVersion"`
			Reason                string `json:"reason"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode commission policy update: %v", err)
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if body != (struct {
			CommercialStoreTypeID string `json:"commercialStoreTypeId"`
			FulfillmentMode       string `json:"fulfillmentMode"`
			CommissionRateBps     int    `json:"commissionRateBps"`
			ExpectedVersion       int    `json:"expectedVersion"`
			Reason                string `json:"reason"`
		}{"type-1", "PARTNER_CAPTAIN", 1750, 2, "updated policy"}) {
			t.Errorf("commission policy update body = %+v", body)
			http.Error(w, "commission body changed", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"policy":{"commercialStoreTypeId":"type-1","fulfillmentMode":"PARTNER_CAPTAIN","commissionRateBps":1750,"policyVersion":3,"updatedAt":"2026-10-02T00:00:00Z"},"idempotentReplay":false}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.UpdatePartnerStoreCommissionPolicy(context.Background(), PartnerStoreCommissionPolicyUpdate{
		CommercialStoreTypeID: " type-1 ", FulfillmentMode: " PARTNER_CAPTAIN ", CommissionRateBps: 1750,
		ExpectedVersion: 2, Reason: " updated policy ", IdempotencyKey: "commission-key",
		CorrelationID: "commission-correlation", ActingActorID: "operator-1",
	})
	if err != nil || result.Policy.CommercialStoreTypeID != "type-1" || result.Policy.PolicyVersion != 3 || result.IdempotentReplay {
		t.Fatalf("commission policy update result = %+v, error=%v", result, err)
	}
}
