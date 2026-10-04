package wlt

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListPartnerAcceptedStoreCommercialAgreementsContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/wlt/v1/operator/store-commercial-agreements" ||
			r.URL.Query().Get("status") != "PARTNER_ACCEPTED" || r.URL.Query().Get("limit") != "50" || r.URL.Query().Get("cursor") != "eyJjdXJzb3IifQ" {
			t.Errorf("agreement queue request = %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("agreement queue auth = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agreements":[{"agreementId":"agreement-1","storeId":"store-1","partnerActorId":"partner-1","agreementVersion":2,"status":"PARTNER_ACCEPTED","rates":[{"fulfillmentMode":"CUSTOMER_PICKUP","commissionRateBps":500}],"proposedByActorId":"field-1","proposedAt":"2026-10-04T01:02:03Z","partnerAcceptedByActorId":"partner-1","partnerAcceptedAt":"2026-10-04T01:03:03Z","reason":"negotiated terms"}],"nextCursor":"next-cursor"}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	page, err := client.ListPartnerAcceptedStoreCommercialAgreements(context.Background(), "eyJjdXJzb3IifQ", 50)
	if err != nil || len(page.Agreements) != 1 || page.Agreements[0].AgreementVersion != 2 || page.Agreements[0].PartnerAcceptedByActorID == nil || *page.Agreements[0].PartnerAcceptedByActorID != "partner-1" || page.NextCursor != "next-cursor" {
		t.Fatalf("agreement queue result = %#v, error=%v", page, err)
	}
}
