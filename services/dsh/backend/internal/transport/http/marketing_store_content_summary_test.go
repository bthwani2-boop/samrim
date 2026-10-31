package transporthttp

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoreContentSummaryRejectsUnauthorizedAndForgedHeadersBeforeDatabaseRead(t *testing.T) {
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewMarketingWithDependencies(nil, "test-marketing-summary-operator-token", db, nil)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	check := func(name, path, authorization, header string, want int) {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if authorization != "" {
				req.Header.Set("Authorization", authorization)
			}
			if header != "" {
				req.Header.Set(header, "untrusted-actor")
			}
			out := httptest.NewRecorder()
			mux.ServeHTTP(out, req)
			if out.Code != want {
				t.Fatalf("Store summary route accepted unauthorized request: status=%d want=%d body=%s", out.Code, want, out.Body.String())
			}
			if strings.Contains(out.Body.String(), "contentCount") || strings.Contains(out.Body.String(), "storeId") {
				t.Fatal("unauthorized Store marketing data returned")
			}
		})
	}
	check("partner without session", "/dsh/partner/stores/store-A/discovery-content/summary", "", "", http.StatusUnauthorized)
	check("partner cannot inject operator ID", "/dsh/partner/stores/store-A/discovery-content/summary", "Bearer unverified", "X-Acting-Actor-ID", http.StatusBadRequest)
	check("partner cannot inject client actor ID", "/dsh/partner/stores/store-A/discovery-content/summary", "Bearer unverified", "X-Actor-ID", http.StatusBadRequest)
	check("operator without service auth", "/dsh/operator/stores/store-A/discovery-content/summary", "", "", http.StatusUnauthorized)
	check("operator forged client actor", "/dsh/operator/stores/store-A/discovery-content/summary", "Bearer test-marketing-summary-operator-token", "X-Actor-ID", http.StatusBadRequest)
	check("operator missing acting actor", "/dsh/operator/stores/store-A/discovery-content/summary", "Bearer test-marketing-summary-operator-token", "", http.StatusBadRequest)
}

func TestStoreContentSummaryRejectsInvalidOrAmbiguousPeriodsBeforeDatabaseRead(t *testing.T) {
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewMarketingWithDependencies(nil, "marketing-summary-period-check", db, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, period := range []string{"period=14d", "period=7d&period=all", "period=30d&period=30d"} {
		t.Run(period, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/dsh/operator/stores/store-A/discovery-content/summary?"+period, nil)
			req.SetPathValue("storeId", "store-A")
			out := httptest.NewRecorder()
			server.writeStoreContentSummary(out, req)
			if out.Code != http.StatusBadRequest {
				t.Fatalf("invalid period accepted or database accessed: status=%d body=%s", out.Code, out.Body.String())
			}
			if strings.Contains(out.Body.String(), "attributedOrdersCompleted") {
				t.Fatal("invalid period revealed summary")
			}
		})
	}
}
