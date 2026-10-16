package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestOperatorHomeAnalyticsRejectsRequestsBeforeDatabaseRead(t *testing.T) {
	const bearer = "ssssssssssssssssssssssss"
	token, err := auth.NewServiceToken(bearer)
	if err != nil {
		t.Fatal(err)
	}
	server := &OrderServer{auth: token}
	for _, tc := range []struct {
		name   string
		token  bool
		actor  string
		status int
	}{
		{name: "unauthenticated", status: http.StatusUnauthorized},
		{name: "missing actor", token: true, status: http.StatusBadRequest},
		{name: "overlong actor", token: true, actor: strings.Repeat("a", 129), status: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/dsh/operator/home-analytics", nil)
			if tc.token {
				req.Header.Set("Authorization", "Bearer "+bearer)
			}
			req.Header.Set("X-Acting-Actor-ID", tc.actor)
			rec := httptest.NewRecorder()
			server.readOperatorHomeAnalytics(rec, req)
			if rec.Code != tc.status || strings.Contains(rec.Body.String(), "days") {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}
