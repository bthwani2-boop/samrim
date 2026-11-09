package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestIndependentReviewRejectsUnauthenticatedOperatorWithoutDatabase(t *testing.T) {
	token, err := auth.NewServiceToken("valid-isolated-control-service-token-for-independent-review")
	if err != nil {
		t.Fatal(err)
	}
	server := &StorePublicationServer{auth: token}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, tc := range []struct{ token, actor string }{
		{"", ""},
		{"", "spoofed-operator"},
		{"Bearer forged-service", "spoofed-operator"},
	} {
		req := httptest.NewRequest(http.MethodPost,
			"/dsh/operator/independent-stores/hidden-store/review-decision",
			strings.NewReader(`{"action":"APPROVE","expectedVersion":1,"reason":"Unauthorised publish"}`))
		if tc.token != "" {
			req.Header.Set("Authorization", tc.token)
		}
		if tc.actor != "" {
			req.Header.Set("X-Acting-Actor-ID", tc.actor)
		}
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusUnauthorized {
			t.Fatalf("untrusted operator not rejected: %d %s", res.Code, res.Body.String())
		}
		if res.Header().Get("Cache-Control") != "no-store" || res.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
			t.Fatalf("untrusted operator response could be indexed or cached: %+v", res.Header())
		}
	}
}
