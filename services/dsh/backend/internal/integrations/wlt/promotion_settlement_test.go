package wlt

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPromotionSettlementReadUsesServiceAndActorAuthorities(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/wlt/v1/operator/promotion-settlement/promo-1" {
			t.Fatalf("wrong settlement read: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Acting-Actor-ID") != "operator-1" {
			t.Fatalf("settlement read lost service or operator authority")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"promotionId":"promo-1","settledOrderCount":1,"settledDiscountMinor":300,"partnerFundedMinor":120,"platformFrozenMinor":180,"platformPostedExpenseMinor":180,"currency":"YER","basis":"POSTED_SETTLEMENT_NOT_NET_REFUNDS"}`))
	}))
	defer server.Close()
	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	summary, err := client.ReadPromotionSettlementSummary(t.Context(), "promo-1", "operator-1")
	if err != nil || summary.PlatformPostedExpenseMinor != 180 || summary.PartnerFundedMinor != 120 || summary.SettledOrderCount != 1 {
		t.Fatalf("settlement authority/readback mismatch: %+v err=%v", summary, err)
	}
}
