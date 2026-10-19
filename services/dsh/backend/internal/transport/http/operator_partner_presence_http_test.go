package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestOperatorPartnerPresenceRejectsUnauthorizedAndUnboundedInputs(t *testing.T) {
	token, err := auth.NewServiceToken("ssssssssssssssssssssssss")
	if err != nil {
		t.Fatal(err)
	}
	server := &StorePublicationServer{auth: token}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /dsh/operator/stores/partner-presence", server.readPartnerStorePresence)
	cases := []struct {
		name, payload         string
		authenticated, acting bool
		want                  int
	}{
		{"unauthenticated", "{\"actorIds\":[\"actor-1\"]}", false, false, 401},
		{"missing operator", "{\"actorIds\":[\"actor-1\"]}", true, false, 400},
		{"malformed", "{", true, true, 400},
		{"unknown field", "{\"actorIds\":[\"actor-1\"],\"extra\":1}", true, true, 400},
		{"empty", "{\"actorIds\":[]}", true, true, 400},
		{"duplicate", "{\"actorIds\":[\"actor-1\",\"actor-1\"]}", true, true, 400},
		{"whitespace", "{\"actorIds\":[\" actor-1\"]}", true, true, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/dsh/operator/stores/partner-presence", strings.NewReader(tc.payload))
			if tc.authenticated {
				req.Header.Set("Authorization", "Bearer ssssssssssssssssssssssss")
			}
			if tc.acting {
				req.Header.Set("X-Acting-Actor-ID", "operator-test")
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status %d want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
