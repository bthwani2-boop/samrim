package transporthttp

import (
	"encoding/json"
	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFieldWalletHistoryIsBoundToSessionAndKeepsLifecycleSeparate(t *testing.T) {
	identityServer, identity, serviceAuth, _ := newFieldFinanceValidationServer(t)
	_ = identityServer
	wltServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("w", 24) || r.URL.Path != "/wlt/v1/fields/field-actor/wallet-history" || r.URL.Query().Get("limit") != "20" || r.URL.Query().Get("cursor") != "opaque-ledger-cursor" {
			http.Error(w, "Field wallet history request is not session-bound or paginated", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"currency":"YER","entries":[{"type":"FIELD_ACQUISITION_ENTITLEMENT_POSTED","direction":"CREDIT","amountMinor":250,"currency":"YER","createdAt":"2026-10-04T01:02:03Z","balanceAfterMinor":250}],"nextCursor":"next-ledger","limit":20}`))
	}))
	t.Cleanup(wltServer.Close)
	payment, err := wlt.New(wltServer.URL, "test", strings.Repeat("w", 24))
	if err != nil {
		t.Fatalf("create WLT client: %v", err)
	}
	server := &FieldFinanceServer{auth: serviceAuth, identity: identity, payment: payment}
	mux := http.NewServeMux()
	server.Register(mux)
	request := httptest.NewRequest(http.MethodGet, "/dsh/fields/me/wallet-history?limit=20&cursor=opaque-ledger-cursor&actorId=another-field", nil)
	request.Header.Set("Authorization", "Bearer field-session")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Field history status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"actorId", "transactionId", "sourceId", "sourceType"} {
		if _, exists := payload[field]; exists || strings.Contains(response.Body.String(), `"`+field+`"`) {
			t.Fatalf("Field history exposed forbidden %q: %s", field, response.Body.String())
		}
	}
	if !strings.Contains(response.Body.String(), `"direction":"CREDIT"`) || !strings.Contains(response.Body.String(), `"nextCursor":"next-ledger"`) {
		t.Fatalf("Field history lost ledger fields or cursor: %s", response.Body.String())
	}
}

func TestFieldWalletHistoryRequiresFieldSession(t *testing.T) {
	_, _, _, mux := newFieldFinanceValidationServer(t)
	for _, path := range []string{"/dsh/fields/me/wallet-history", "/dsh/fields/me/payout-requests"} {
		for _, tc := range []struct {
			token string
			want  int
		}{{token: "", want: http.StatusUnauthorized}, {token: "Bearer partner-session", want: http.StatusForbidden}} {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			if tc.token != "" {
				request.Header.Set("Authorization", tc.token)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("%s auth status=%d want=%d body=%s", path, response.Code, tc.want, response.Body.String())
			}
		}
	}
}

func TestFieldWalletHistoryRejectsInvalidPaginationBeforeWLT(t *testing.T) {
	_, _, _, mux := newFieldFinanceValidationServer(t)
	for _, path := range []string{"/dsh/fields/me/wallet-history", "/dsh/fields/me/payout-requests"} {
		for _, query := range []string{"?limit=0", "?limit=101", "?cursor=" + strings.Repeat("c", 513)} {
			request := httptest.NewRequest(http.MethodGet, path+query, nil)
			request.Header.Set("Authorization", "Bearer field-session")
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
				t.Fatalf("%s invalid query %q status=%d body=%s", path, query, response.Code, response.Body.String())
			}
		}
	}
}

func TestFieldPayoutRequestHistoryKeepsCurrentRequestStateDistinct(t *testing.T) {
	_, identity, serviceAuth, _ := newFieldFinanceValidationServer(t)
	wltServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("w", 24) || r.URL.Path != "/wlt/v1/fields/field-actor/payout-requests" || r.URL.Query().Get("limit") != "10" || r.URL.Query().Get("cursor") != "opaque-request-cursor" {
			http.Error(w, "payout request query changed", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"requests":[{"status":"HELD","amountMinor":250,"currency":"YER","createdAt":"2026-10-04T01:02:03Z"}],"nextCursor":"next-request","limit":10}`))
	}))
	t.Cleanup(wltServer.Close)
	payment, err := wlt.New(wltServer.URL, "test", strings.Repeat("w", 24))
	if err != nil {
		t.Fatalf("create WLT client: %v", err)
	}
	mux := http.NewServeMux()
	(&FieldFinanceServer{auth: serviceAuth, identity: identity, payment: payment}).Register(mux)
	request := httptest.NewRequest(http.MethodGet, "/dsh/fields/me/payout-requests?limit=10&cursor=opaque-request-cursor&actorId=another-field", nil)
	request.Header.Set("Authorization", "Bearer field-session")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"HELD"`) || !strings.Contains(response.Body.String(), `"amountMinor":250`) || strings.Contains(response.Body.String(), `"direction"`) || strings.Contains(response.Body.String(), `"actorId"`) {
		t.Fatalf("payout request history is not separated and reduced: status=%d body=%s", response.Code, response.Body.String())
	}
}
