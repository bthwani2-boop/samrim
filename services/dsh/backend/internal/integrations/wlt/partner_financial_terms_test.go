package wlt

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newPartnerFinancialTermsClient(t *testing.T) *Client {
	t.Helper()
	mux := http.NewServeMux()
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

func readPartnerTermsResponse(w http.ResponseWriter, _ *http.Request) {
	writePartnerTermsJSON(w, `{"policy":{"policyVersion":"partner-financial-terms:v1","state":"ACTIVE","settlementPeriod":"MONTHLY","version":1}}`)
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
	writePartnerTermsJSON(w, `{"policy":{"policyVersion":"partner-financial-terms:v1","state":"ACTIVE","settlementPeriod":"MONTHLY","version":1},"idempotentReplay":false}`)
}

func writePartnerTermsJSON(w http.ResponseWriter, value string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(value))
}

func TestReadPartnerFinancialTermsPolicyContract(t *testing.T) {
	terms, err := newPartnerFinancialTermsClient(t).ReadPartnerFinancialTermsPolicy(context.Background())
	if err != nil || terms.State != "ACTIVE" || terms.PolicyVersion != "partner-financial-terms:v1" {
		t.Fatalf("read partner terms result: terms=%#v err=%v", terms, err)
	}
}

func TestCreatePartnerFinancialTermsPolicyContract(t *testing.T) {
	terms, replay, err := newPartnerFinancialTermsClient(t).CreatePartnerFinancialTermsPolicy(context.Background(), " monthly ", 0, "runtime proof", "terms-key", "terms-correlation", "operator-1")
	if err != nil || replay || terms.SettlementPeriod != "MONTHLY" || terms.PolicyVersion != "partner-financial-terms:v1" {
		t.Fatalf("create partner terms result: terms=%#v replay=%v err=%v", terms, replay, err)
	}
}
