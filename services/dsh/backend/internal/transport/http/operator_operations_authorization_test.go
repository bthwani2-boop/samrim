package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestOperatorOperationsSummaryRejectsUnauthenticatedAndInvalidQueries(t *testing.T) {
	const tokenValue = "ssssssssssssssssssssssss"
	token, err := auth.NewServiceToken(tokenValue)
	if err != nil {
		t.Fatal(err)
	}
	server := &OrderServer{auth: token}
	for _, tc := range []struct {
		name, query, actor string
		authenticated      bool
		status             int
	}{
		{"unauthenticated", "", "operator", false, 401},
		{"missing actor", "", "", true, 400},
		{"unbounded page", "?limit=101", "operator", true, 400},
		{"unknown state", "?state=UNKNOWN", "operator", true, 400},
		{"unknown sort", "?sort=UNKNOWN", "operator", true, 400},
		{"invalid actionable", "?actionableOnly=1", "operator", true, 400},
		{"overlong cursor", "?cursor=" + strings.Repeat("x", 2049), "operator", true, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/dsh/operator/operations"+tc.query, nil)
			if tc.authenticated {
				req.Header.Set("Authorization", "Bearer "+tokenValue)
			}
			req.Header.Set("X-Acting-Actor-ID", tc.actor)
			rec := httptest.NewRecorder()
			server.listOperatorOperations(rec, req)
			if rec.Code != tc.status || strings.Contains(rec.Body.String(), "summary") {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}
