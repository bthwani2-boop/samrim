package wlt

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newFieldFinanceClient(t *testing.T) *Client {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /wlt/v1/operator/field-acquisition-reward-policies", createRewardPolicyResponse)
	mux.HandleFunc("GET /wlt/v1/operator/field-acquisition-reward-policies", readRewardPolicyResponse)
	mux.HandleFunc("POST /wlt/v1/field-acquisition-entitlements/finalize", finalizeRewardResponse)
	mux.HandleFunc("GET /wlt/v1/fields/field-1/financial-summary", fieldSummaryResponse)
	mux.HandleFunc("GET /wlt/v1/fields/field-1/acquisition-entitlements", fieldEntitlementsResponse)
	mux.HandleFunc("GET /wlt/v1/operator/partner-financial-terms-policy", readPartnerTermsResponse)
	mux.HandleFunc("POST /wlt/v1/operator/partner-financial-terms-policy", createPartnerTermsResponse)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	client, err := New(server.URL, "test", "test-token")
	if err != nil {
		t.Fatalf("create WLT test client: %v", err)
	}
	return client
}

func createRewardPolicyResponse(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Acting-Actor-ID") != "operator-1" || r.Header.Get("Idempotency-Key") != "policy-key" || r.Header.Get("X-Correlation-ID") != "policy-correlation" {
		http.Error(w, "reward policy mutation headers are incomplete", http.StatusBadRequest)
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid reward policy body", http.StatusBadRequest)
		return
	}
	if body["scopeType"] != "STORE_TYPE" || body["scopeId"] != "type-1" || body["rewardMinor"] != float64(250) || body["roundingUnitMinor"] != float64(25) || body["reason"] != "location reward proof" {
		http.Error(w, "reward policy contract values changed", http.StatusBadRequest)
		return
	}
	writeFieldFinanceJSON(w, `{"policy":{"id":"policy-1","scopeType":"STORE_TYPE","scopeId":"type-1","state":"ACTIVE","rewardMinor":250,"roundingUnitMinor":25,"version":1},"idempotentReplay":true}`)
}

func readRewardPolicyResponse(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("scopeType") != "STORE_TYPE" || r.URL.Query().Get("scopeId") != "type-1" {
		http.Error(w, "reward policy scope query changed", http.StatusBadRequest)
		return
	}
	writeFieldFinanceJSON(w, `{"policy":{"id":"policy-1","scopeType":"STORE_TYPE","scopeId":"type-1","state":"ACTIVE","rewardMinor":250,"roundingUnitMinor":25,"version":1}}`)
}

func finalizeRewardResponse(w http.ResponseWriter, _ *http.Request) {
	writeFieldFinanceJSON(w, `{"entitlement":{"id":"entitlement-1","joiningCaseId":"case-1","storeId":"store-1","partnerActorId":"partner-1","fieldActorId":"field-1","verticalId":"vertical-1","commercialStoreTypeId":"type-1","policyId":"policy-1","policyVersion":1,"rewardMinor":250,"currency":"YER","ledgerTransactionId":"ledger-1"},"idempotentReplay":false}`)
}

func fieldSummaryResponse(w http.ResponseWriter, _ *http.Request) {
	writeFieldFinanceJSON(w, `{"summary":{"fieldActorId":"field-1","currency":"YER","earnedMinor":500,"entitlementMinor":250,"partnerCount":2}}`)
}

func fieldEntitlementsResponse(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("limit") != "20" || r.URL.Query().Get("cursor") != "cursor-1" {
		http.Error(w, "field entitlement pagination changed", http.StatusBadRequest)
		return
	}
	writeFieldFinanceJSON(w, `{"entitlements":[{"id":"entitlement-1","storeId":"store-1","fieldActorId":"field-1","rewardMinor":250}],"nextCursor":"cursor-2"}`)
}

func readPartnerTermsResponse(w http.ResponseWriter, _ *http.Request) {
	writeFieldFinanceJSON(w, `{"policy":{"policyVersion":"partner-financial-terms:v1","state":"ACTIVE","settlementPeriod":"MONTHLY","version":1}}`)
}

func createPartnerTermsResponse(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid partner terms body", http.StatusBadRequest)
		return
	}
	if body["settlementPeriod"] != "MONTHLY" || body["expectedVersion"] != float64(0) {
		http.Error(w, "partner terms contract values changed", http.StatusBadRequest)
		return
	}
	writeFieldFinanceJSON(w, `{"policy":{"policyVersion":"partner-financial-terms:v1","state":"ACTIVE","settlementPeriod":"MONTHLY","version":1},"idempotentReplay":false}`)
}

func writeFieldFinanceJSON(w http.ResponseWriter, value string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(value))
}

func TestCreateFieldAcquisitionRewardPolicyContract(t *testing.T) {
	client := newFieldFinanceClient(t)
	policy, replay, err := client.CreateFieldAcquisitionRewardPolicy(context.Background(), CreateFieldAcquisitionRewardPolicyInput{ScopeType: " STORE_TYPE ", ScopeID: " type-1 ", RewardMinor: 250, RoundingUnitMinor: 25, ExpectedVersion: 0, Reason: " location reward proof ", IdempotencyKey: "policy-key", CorrelationID: "policy-correlation", ActingActorID: "operator-1"})
	if err != nil || !replay || policy.ID != "policy-1" || policy.ScopeID != "type-1" {
		t.Fatalf("create reward policy result: policy=%#v replay=%v err=%v", policy, replay, err)
	}
}

func TestReadFieldAcquisitionRewardPolicyContract(t *testing.T) {
	policy, err := newFieldFinanceClient(t).ReadFieldAcquisitionRewardPolicyByScope(context.Background(), " STORE_TYPE ", " type-1 ")
	if err != nil || policy.ID != "policy-1" || policy.ScopeID != "type-1" {
		t.Fatalf("read reward policy result: policy=%#v err=%v", policy, err)
	}
}

func TestFinalizeFieldAcquisitionRewardContract(t *testing.T) {
	entitlement, replay, err := newFieldFinanceClient(t).FinalizeFieldAcquisitionReward(context.Background(), FinalizeFieldAcquisitionRewardInput{JoiningCaseID: "case-1", StoreID: "store-1", PartnerActorID: "partner-1", FieldActorID: "field-1", VerticalID: "vertical-1", CommercialStoreTypeID: "type-1", IdempotencyKey: "entitlement-key", CorrelationID: "entitlement-correlation"})
	if err != nil || replay || entitlement.LedgerTransactionID != "ledger-1" || entitlement.CommercialStoreTypeID != "type-1" {
		t.Fatalf("finalize entitlement result: entitlement=%#v replay=%v err=%v", entitlement, replay, err)
	}
}

func TestReadFieldFinancialSummaryContract(t *testing.T) {
	summary, err := newFieldFinanceClient(t).ReadFieldFinancialSummary(context.Background(), "field-1")
	if err != nil || summary.FieldActorID != "field-1" || summary.EarnedMinor != 500 {
		t.Fatalf("field summary result: summary=%#v err=%v", summary, err)
	}
}

func TestListFieldAcquisitionEntitlementsContract(t *testing.T) {
	page, err := newFieldFinanceClient(t).ListFieldAcquisitionEntitlements(context.Background(), "field-1", "cursor-1", 20)
	if err != nil || page.NextCursor != "cursor-2" || len(page.Entitlements) != 1 || page.Entitlements[0].StoreID != "store-1" {
		t.Fatalf("field entitlement page: page=%#v err=%v", page, err)
	}
}

func TestReadPartnerFinancialTermsPolicyContract(t *testing.T) {
	terms, err := newFieldFinanceClient(t).ReadPartnerFinancialTermsPolicy(context.Background())
	if err != nil || terms.State != "ACTIVE" || terms.PolicyVersion != "partner-financial-terms:v1" {
		t.Fatalf("read partner terms result: terms=%#v err=%v", terms, err)
	}
}

func TestCreatePartnerFinancialTermsPolicyContract(t *testing.T) {
	terms, replay, err := newFieldFinanceClient(t).CreatePartnerFinancialTermsPolicy(context.Background(), " monthly ", 0, "runtime proof", "terms-key", "terms-correlation", "operator-1")
	if err != nil || replay || terms.SettlementPeriod != "MONTHLY" || terms.PolicyVersion != "partner-financial-terms:v1" {
		t.Fatalf("create partner terms result: terms=%#v replay=%v err=%v", terms, replay, err)
	}
}
