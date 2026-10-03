package wlt

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestPartnerFinanceClientContracts(t *testing.T) {
	type requestRecord struct {
		method      string
		path        string
		query       string
		actor       string
		key         string
		correlation string
		body        map[string]any
	}
	var requests []requestRecord
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record := requestRecord{
			method: r.Method, path: r.URL.Path, query: r.URL.RawQuery,
			actor: r.Header.Get("X-Acting-Actor-ID"), key: r.Header.Get("Idempotency-Key"),
			correlation: r.Header.Get("X-Correlation-ID"),
		}
		if r.Body != nil {
			payload, err := io.ReadAll(r.Body)
			if err != nil {
				t.Errorf("read WLT request body: %v", err)
			} else if len(payload) != 0 {
				if err := json.Unmarshal(payload, &record.body); err != nil {
					t.Errorf("decode WLT request body: %v", err)
				}
			}
		}
		requests = append(requests, record)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"profile":{"id":"profile-1"},"earning":{"orderId":"order-1"},"commission":{"orderId":"order-1"},"remittance":{"id":"remittance-1"},"summary":{"partnerActorId":"partner-1"},"receivables":[],"idempotentReplay":true}`)
	}))
	t.Cleanup(server.Close)
	client, err := New(server.URL, "test", "service-token")
	if err != nil {
		t.Fatalf("create WLT client: %v", err)
	}
	ctx := context.Background()

	if profile, replay, err := client.PreparePartnerFinancialProfile(ctx, PreparePartnerFinancialProfileInput{
		JoiningCaseID: " case-1 ", PartnerActorID: " partner-1 ", Origin: " field ",
		SettlementPeriod: " MONTHLY ", TermsPolicyVersion: " terms-v1 ",
		IdempotencyKey: " profile-key ", CorrelationID: " profile-correlation ",
	}); err != nil || !replay || profile.ID != "profile-1" {
		t.Fatalf("prepare financial profile = (%+v, replay=%t, %v)", profile, replay, err)
	}
	if earning, replay, err := client.FinalizePartnerOrderEarning(ctx, " order-1 ", " payment-1 ", " partner-1 ", " captain-1 ", " earning-key ", " earning-correlation "); err != nil || !replay || earning.OrderID != "order-1" {
		t.Fatalf("finalize partner earning = (%+v, replay=%t, %v)", earning, replay, err)
	}
	if commission, replay, err := client.FinalizePartnerStoreCashCommission(ctx, " order-1 ", " payment-1 ", " partner-1 ", " PARTNER_CAPTAIN ", " commission-key ", " commission-correlation "); err != nil || !replay || commission.OrderID != "order-1" {
		t.Fatalf("finalize partner cash commission = (%+v, replay=%t, %v)", commission, replay, err)
	}
	if remittance, replay, err := client.RecordPartnerCommissionRemittance(ctx, " partner-1 ", 1250, " transfer-1 ", " receipt-document-1 ", " remittance-key ", " remittance-correlation ", " operator-1 "); err != nil || !replay || remittance.ID != "remittance-1" {
		t.Fatalf("record partner commission remittance = (%+v, replay=%t, %v)", remittance, replay, err)
	}
	if _, err := client.ReadPartnerFinancialSummary(ctx, " partner-1 "); err != nil {
		t.Fatalf("read partner financial summary: %v", err)
	}
	if _, err := client.ListPartnerCommissionReceivables(ctx, " operator-1 ", " shop ", " ACTOR_ASC ", "cursor-1", 25); err != nil {
		t.Fatalf("list partner commission receivables: %v", err)
	}

	wantPaths := []string{
		"/wlt/v1/partner-financial-profiles",
		"/wlt/v1/partner-order-earnings/finalize",
		"/wlt/v1/partner-store-cash-commissions/finalize",
		"/wlt/v1/operator/partners/partner-1/commission-remittances",
		"/wlt/v1/partners/partner-1/financial-summary",
		"/wlt/v1/operator/partner-commission-receivables",
	}
	if len(requests) != len(wantPaths) {
		t.Fatalf("WLT request count = %d, want %d: %+v", len(requests), len(wantPaths), requests)
	}
	for index, want := range wantPaths {
		if requests[index].path != want {
			t.Errorf("WLT request %d path = %q, want %q", index, requests[index].path, want)
		}
	}
	if requests[0].method != http.MethodPost || requests[0].key != "profile-key" || requests[0].correlation != "profile-correlation" || !reflect.DeepEqual(requests[0].body, map[string]any{
		"joiningCaseId": " case-1 ", "partnerActorId": " partner-1 ", "origin": " field ",
		"settlementPeriod": " MONTHLY ", "termsPolicyVersion": " terms-v1 ",
	}) {
		t.Errorf("prepare partner profile request = %+v", requests[0])
	}
	if !reflect.DeepEqual(requests[1].body, map[string]any{"orderId": "order-1", "paymentIntentId": "payment-1", "partnerActorId": "partner-1", "captainActorId": "captain-1"}) {
		t.Errorf("partner earning request body = %#v", requests[1].body)
	}
	if !reflect.DeepEqual(requests[2].body, map[string]any{"orderId": "order-1", "paymentIntentId": "payment-1", "partnerActorId": "partner-1", "fulfillmentMode": "PARTNER_CAPTAIN"}) {
		t.Errorf("partner commission request body = %#v", requests[2].body)
	}
	if requests[3].actor != "operator-1" || requests[3].key != "remittance-key" || requests[3].correlation != "remittance-correlation" || !reflect.DeepEqual(requests[3].body, map[string]any{"amountMinor": float64(1250), "remittanceReference": "transfer-1", "evidenceDocumentId": "receipt-document-1"}) {
		t.Errorf("partner remittance request = %+v", requests[3])
	}
	if requests[5].actor != "operator-1" || requests[5].query != "cursor=cursor-1&limit=25&search=shop&sort=actor_asc" {
		t.Errorf("partner receivables query = %+v", requests[5])
	}
}

func TestWLTRequestBoundaryReportsConfigurationTransportAndResponseFailures(t *testing.T) {
	var nilClient *Client
	if err := nilClient.requestWithActor(context.Background(), actorRequest{method: http.MethodGet, path: "/summary"}); err == nil {
		t.Fatal("unconfigured WLT client request succeeded")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/conflict":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"error":{"code":"VERSION_CONFLICT","message":"stale version"}}`)
		case "/malformed":
			_, _ = io.WriteString(w, "not-json")
		case "/no-content":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	client, err := New(server.URL, "test", "service-token")
	if err != nil {
		t.Fatalf("create WLT client: %v", err)
	}

	if err := client.requestWithActor(context.Background(), actorRequest{method: http.MethodPost, path: "/no-content", body: make(chan int)}); err == nil {
		t.Fatal("unencodable request body was accepted")
	}
	if err := client.requestWithActor(context.Background(), actorRequest{method: http.MethodGet, path: "not a valid URL", target: &map[string]any{}}); err == nil {
		t.Fatal("invalid request URL was accepted")
	}
	var conflictTarget map[string]any
	err = client.requestWithActor(context.Background(), actorRequest{method: http.MethodGet, path: "/conflict", target: &conflictTarget})
	var responseError *Error
	if !errors.As(err, &responseError) || responseError.Status != http.StatusConflict || responseError.Code != "VERSION_CONFLICT" || responseError.Message != "stale version" {
		t.Fatalf("WLT conflict response error = %#v, want canonical service error", err)
	}
	var malformedTarget map[string]any
	if err := client.requestWithActor(context.Background(), actorRequest{method: http.MethodGet, path: "/malformed", target: &malformedTarget}); err == nil {
		t.Fatal("malformed WLT success payload was accepted")
	}
	if err := client.requestWithActor(context.Background(), actorRequest{method: http.MethodGet, path: "/no-content"}); err != nil {
		t.Fatalf("successful response without a decode target failed: %v", err)
	}
	server.Close()
	if err := client.requestWithActor(context.Background(), actorRequest{method: http.MethodGet, path: "/no-content"}); err == nil {
		t.Fatal("transport failure after server closure was ignored")
	}
}

func TestPartnerCommissionReceivableClientRejectsInvalidQueries(t *testing.T) {
	client := &Client{}
	for _, input := range []struct {
		actor  string
		search string
		sort   string
		cursor string
		limit  int
	}{
		{search: "shop", sort: "actor_asc", limit: 25},
		{actor: "operator", search: "shop", sort: "name_asc", limit: 25},
		{actor: "operator", search: string(make([]byte, 129)), sort: "actor_asc", limit: 25},
		{actor: "operator", search: "shop", sort: "actor_asc", cursor: string(make([]byte, 1025)), limit: 25},
		{actor: "operator", search: "shop", sort: "actor_asc", limit: 0},
	} {
		if _, err := client.ListPartnerCommissionReceivables(context.Background(), input.actor, input.search, input.sort, input.cursor, input.limit); err == nil {
			t.Errorf("invalid partner receivables query was accepted: %+v", input)
		}
	}
}
