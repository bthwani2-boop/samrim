package transporthttp

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
)

func TestHRDecisionMutationsRequireIdentityAuthorizedInitialOperator(t *testing.T) {
	const token = "dddddddddddddddddddddddddddd"
	const identityToken = "iiiiiiiiiiiiiiiiiiiiiiiiiiii"
	var calls atomic.Int32
	identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+identityToken {
			http.Error(w, "invalid token", 401)
			return
		}
		if r.URL.Path != "/internal/operator-profiles" || r.Header.Get("X-Acting-Actor-ID") != "act_hr_only" {
			http.Error(w, "unexpected Identity request", 500)
			return
		}
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("{\"error\":{\"code\":\"FORBIDDEN\"}}"))
	}))
	defer identity.Close()
	endpoint, err := identityintegration.ResolveBaseURL(identity.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	client, err := identityintegration.New(endpoint, identityToken)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewHR(client, token, db)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, action := range []string{"reject", "provision", "link", "admit"} {
		t.Run(action, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/dsh/hr/access-requests/hreq_00000000000000000000000000000000/"+action,
				strings.NewReader("{\"expectedVersion\":1,\"reason\":\"Incorrect request\"}"))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-Acting-Actor-ID", "act_hr_only")
			req.Header.Set("X-Correlation-ID", "corr-root-denial")
			req.Header.Set("Idempotency-Key", "idem-root-denial-"+action)
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != 403 {
				t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
			}
		})
	}
	req := httptest.NewRequest("GET", "/dsh/hr/access-requests/by-profile/oprof_00000000000000000000000000000000", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Acting-Actor-ID", "act_hr_only")
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("profile-provenance lookup by HR-only actor: got %d, want 403", res.Code)
	}
	lookup := httptest.NewRequest("GET", "/dsh/hr/operator-employees/act_existing", nil)
	lookup.Header.Set("Authorization", "Bearer "+token)
	lookup.Header.Set("X-Acting-Actor-ID", "act_hr_only")
	lookupResponse := httptest.NewRecorder()
	mux.ServeHTTP(lookupResponse, lookup)
	if lookupResponse.Code != http.StatusForbidden {
		t.Fatalf("employee-by-actor lookup by HR-only actor: got %d, want 403", lookupResponse.Code)
	}
	if calls.Load() != 6 {
		t.Fatalf("Root authority checks=%d, expected 6", calls.Load())
	}
}
