package wlt

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFieldAcquisitionAndPartnerTermsClientContracts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/wlt/v1/operator/field-acquisition-reward-policies":
			if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Acting-Actor-ID") != "operator-1" || r.Header.Get("Idempotency-Key") != "policy-key" || r.Header.Get("X-Correlation-ID") != "policy-correlation" {
				t.Errorf("policy mutation headers are incomplete: %#v", r.Header)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode policy request: %v", err)
			}
			if body["scopeType"] != "STORE_TYPE" || body["scopeId"] != "type-1" || body["rewardMinor"] != float64(250) || body["roundingUnitMinor"] != float64(25) || body["reason"] != "location reward proof" {
				t.Errorf("policy request did not preserve normalized contract values: %#v", body)
			}
			_, _ = w.Write([]byte(`{"policy":{"id":"policy-1","scopeType":"STORE_TYPE","scopeId":"type-1","state":"ACTIVE","rewardMinor":250,"roundingUnitMinor":25,"version":1},"idempotentReplay":true}`))
		case r.Method == http.MethodGet && r.URL.Path == "/wlt/v1/operator/field-acquisition-reward-policies":
			if r.URL.Query().Get("scopeType") != "STORE_TYPE" || r.URL.Query().Get("scopeId") != "type-1" {
				t.Errorf("policy lookup scope = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"policy":{"id":"policy-1","scopeType":"STORE_TYPE","scopeId":"type-1","state":"ACTIVE","rewardMinor":250,"roundingUnitMinor":25,"version":1}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/wlt/v1/field-acquisition-entitlements/finalize":
			_, _ = w.Write([]byte(`{"entitlement":{"id":"entitlement-1","joiningCaseId":"case-1","storeId":"store-1","partnerActorId":"partner-1","fieldActorId":"field-1","verticalId":"vertical-1","commercialStoreTypeId":"type-1","policyId":"policy-1","policyVersion":1,"rewardMinor":250,"currency":"YER","ledgerTransactionId":"ledger-1"},"idempotentReplay":false}`))
		case r.Method == http.MethodGet && r.URL.Path == "/wlt/v1/fields/field-1/financial-summary":
			_, _ = w.Write([]byte(`{"summary":{"fieldActorId":"field-1","currency":"YER","earnedMinor":500,"entitlementMinor":250,"partnerCount":2}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/wlt/v1/fields/field-1/acquisition-entitlements":
			if r.URL.Query().Get("limit") != "20" || r.URL.Query().Get("cursor") != "cursor-1" {
				t.Errorf("entitlement page query = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"entitlements":[{"id":"entitlement-1","storeId":"store-1","fieldActorId":"field-1","rewardMinor":250}],"nextCursor":"cursor-2"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/wlt/v1/operator/partner-financial-terms-policy":
			_, _ = w.Write([]byte(`{"policy":{"policyVersion":"partner-financial-terms:v1","state":"ACTIVE","settlementPeriod":"MONTHLY","version":1}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/wlt/v1/operator/partner-financial-terms-policy":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode financial terms request: %v", err)
			}
			if body["settlementPeriod"] != "MONTHLY" || body["expectedVersion"] != float64(0) {
				t.Errorf("financial terms request = %#v", body)
			}
			_, _ = w.Write([]byte(`{"policy":{"policyVersion":"partner-financial-terms:v1","state":"ACTIVE","settlementPeriod":"MONTHLY","version":1},"idempotentReplay":false}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := New(server.URL, "test", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	policy, replay, err := client.CreateFieldAcquisitionRewardPolicy(ctx, CreateFieldAcquisitionRewardPolicyInput{ScopeType: " STORE_TYPE ", ScopeID: " type-1 ", RewardMinor: 250, RoundingUnitMinor: 25, ExpectedVersion: 0, Reason: " location reward proof ", IdempotencyKey: "policy-key", CorrelationID: "policy-correlation", ActingActorID: "operator-1"})
	if err != nil || !replay || policy.ID != "policy-1" || policy.ScopeID != "type-1" {
		t.Fatalf("create reward policy result: policy=%#v replay=%v err=%v", policy, replay, err)
	}
	policy, err = client.ReadFieldAcquisitionRewardPolicyByScope(ctx, " STORE_TYPE ", " type-1 ")
	if err != nil || policy.ID != "policy-1" {
		t.Fatalf("read reward policy result: policy=%#v err=%v", policy, err)
	}
	entitlement, replay, err := client.FinalizeFieldAcquisitionReward(ctx, FinalizeFieldAcquisitionRewardInput{JoiningCaseID: "case-1", StoreID: "store-1", PartnerActorID: "partner-1", FieldActorID: "field-1", VerticalID: "vertical-1", CommercialStoreTypeID: "type-1", IdempotencyKey: "entitlement-key", CorrelationID: "entitlement-correlation"})
	if err != nil || replay || entitlement.LedgerTransactionID != "ledger-1" || entitlement.CommercialStoreTypeID != "type-1" {
		t.Fatalf("finalize entitlement result: entitlement=%#v replay=%v err=%v", entitlement, replay, err)
	}
	summary, err := client.ReadFieldFinancialSummary(ctx, "field-1")
	if err != nil || summary.FieldActorID != "field-1" || summary.EarnedMinor != 500 {
		t.Fatalf("field summary result: summary=%#v err=%v", summary, err)
	}
	page, err := client.ListFieldAcquisitionEntitlements(ctx, "field-1", "cursor-1", 20)
	if err != nil || page.NextCursor != "cursor-2" || len(page.Entitlements) != 1 || page.Entitlements[0].StoreID != "store-1" {
		t.Fatalf("field entitlement page: page=%#v err=%v", page, err)
	}
	terms, err := client.ReadPartnerFinancialTermsPolicy(ctx)
	if err != nil || terms.State != "ACTIVE" || terms.PolicyVersion != "partner-financial-terms:v1" {
		t.Fatalf("read partner terms result: terms=%#v err=%v", terms, err)
	}
	terms, replay, err = client.CreatePartnerFinancialTermsPolicy(ctx, " monthly ", 0, "runtime proof", "terms-key", "terms-correlation", "operator-1")
	if err != nil || replay || terms.SettlementPeriod != "MONTHLY" || terms.PolicyVersion != "partner-financial-terms:v1" {
		t.Fatalf("create partner terms result: terms=%#v replay=%v err=%v", terms, replay, err)
	}
}
