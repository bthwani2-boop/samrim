package identityhttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Authorization is checked before any DB mutation. The successful transaction
// is verified through Identity actor/session integration and review gates.
func TestDirectPartnerRegistrationRejectsUntrustedOrUnauthenticatedRequests(t *testing.T) {
	server := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins:    map[string]bool{"http://localhost:18102": true},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	})
	for _, tc := range []struct {
		name, origin, body, bearer, spoof string
		want                              int
	}{
		{"untrusted_origin", "http://localhost:9999", "{}", "", "", http.StatusForbidden},
		{"trusted_no_bearer", "http://localhost:18102", "{}", "", "", http.StatusUnauthorized},
		{"trusted_actor_spoof", "http://localhost:18102", "{}", "Bearer fake", "someone-else", http.StatusForbidden},
		{"trusted_invalid_body", "http://localhost:18102", "{", "Bearer fake", "", http.StatusBadRequest},
		{"native_requires_bearer", "", "{}", "", "", http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/partner/self/register", strings.NewReader(tc.body))
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.bearer != "" {
				req.Header.Set("Authorization", tc.bearer)
			}
			if tc.spoof != "" {
				req.Header.Set("X-Acting-Actor-ID", tc.spoof)
			}
			rec := httptest.NewRecorder()
			server.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d want=%d", rec.Code, tc.want)
			}
			if len(rec.Result().Cookies()) != 0 {
				t.Fatal("rejected request set a session cookie")
			}
		})
	}
}
