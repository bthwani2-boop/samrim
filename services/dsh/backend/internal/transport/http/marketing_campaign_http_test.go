package transporthttp

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/lib/pq"
)

func TestMarketingCampaignOperatorEndpointsRejectUnauthenticatedRequest(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://test:test@127.0.0.1:1/no_connection?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	server, err := NewMarketing("marketing-operator-test-token", db)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /dsh/operator/{actorType}/{actorId}/payout-state", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	server.Register(mux)
	for _, route := range []struct{ method, path string }{
		{"GET", "/dsh/operator/marketing/campaigns"},
		{"POST", "/dsh/operator/marketing/campaigns"},
		{"GET", "/dsh/operator/marketing/campaigns/test-campaign/details"},
		{"POST", "/dsh/operator/marketing/campaigns/test-campaign/state"},
		{"POST", "/dsh/operator/marketing/campaigns/test-campaign/elements"},
	} {
		req := httptest.NewRequest(route.method, route.path, nil)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, expected 401", route.method, route.path, recorder.Code)
		}
	}
}
