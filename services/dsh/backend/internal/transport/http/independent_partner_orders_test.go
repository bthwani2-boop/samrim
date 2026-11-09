package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndependentPartnerOrdersRejectUntrustedRequestsBeforeDataAccess(t *testing.T) {
	mux := http.NewServeMux()
	(&OrderServer{}).Register(mux)
	for _, tc := range []struct {
		name, method, path, body, actor string
		status                          int
	}{
		{"list missing token", "GET", "/dsh/partner/stores/store-a/direct-orders", "", "", http.StatusUnauthorized},
		{"transition missing token", "PATCH", "/dsh/partner/stores/store-a/direct-orders/order-a", `{"state":"ACCEPTED","expectedVersion":1}`, "", http.StatusUnauthorized},
		{"list spoofed X-Actor-ID", "GET", "/dsh/partner/stores/store-a/direct-orders", "", "X-Actor-ID", http.StatusBadRequest},
		{"transition spoofed X-Acting-Actor-ID", "PATCH", "/dsh/partner/stores/store-a/direct-orders/order-a", `{"state":"ACCEPTED","expectedVersion":1}`, "X-Acting-Actor-ID", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.name != "list missing token" && tc.name != "transition missing token" {
				req.Header.Set("Authorization", "Bearer test-token")
			}
			if tc.actor != "" {
				req.Header.Set(tc.actor, "untrusted-actor")
			}
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("got HTTP %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if got := w.Header().Get("Cache-Control"); got != "no-store" && got != "private, no-store" {
				t.Errorf("private order response must disable caching: Cache-Control=%q", got)
			}
			if got := w.Header().Get("X-Robots-Tag"); got != "noindex, nofollow" {
				t.Errorf("private order response crawler hint=%q", got)
			}
		})
	}
}

func TestIndependentPartnerOrderInvalidTransitionBodyFailsBeforeService(t *testing.T) {
	mux := http.NewServeMux()
	(&OrderServer{}).Register(mux)
	for _, tc := range []struct {
		name, body string
	}{
		{"malformed JSON", "{invalid json"},
		{"actor spoof in body", `{"state":"ACCEPTED","expectedVersion":1,"actorId":"foreign-actor"}`},
		{"Store spoof in body", `{"state":"ACCEPTED","expectedVersion":1,"storeId":"foreign-store"}`},
		{"second JSON value", `{"state":"ACCEPTED","expectedVersion":1}{"state":"REJECTED","expectedVersion":1}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch,
				"/dsh/partner/stores/store-a/direct-orders/order-a", strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer test-token")
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("invalid transition body status=%d body=%s", w.Code, w.Body.String())
			}
			if got := w.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
				t.Errorf("private error response must disable caching: Cache-Control=%q", got)
			}
			if got := w.Header().Get("X-Robots-Tag"); got != "noindex, nofollow" {
				t.Errorf("private error response crawler hint=%q", got)
			}
			if strings.Contains(w.Body.String(), "foreign-actor") || strings.Contains(w.Body.String(), "foreign-store") {
				t.Fatalf("invalid input response echoed untrusted actor or Store: %s", w.Body.String())
			}
		})
	}
}
