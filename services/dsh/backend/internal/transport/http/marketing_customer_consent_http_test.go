package transporthttp

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/lib/pq"
)

func TestCustomerMarketingConsentEndpointDeniesAnonymousAccess(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://test:test@127.0.0.1:1/no_connection?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewMarketing("marketing-test-token-must-be-long-enough-for-service-auth-2026", db)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, method := range []string{"GET", "POST"} {
		req := httptest.NewRequest(method, "/dsh/client/marketing-consent/PUSH", nil)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s returned %d", method, recorder.Code)
		}
	}
}
