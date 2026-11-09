package transporthttp

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	_ "github.com/lib/pq"
)

func TestStoreJoiningPolicyWriteRequiresPlatformPoliciesPermission(t *testing.T) {
	const actor = "qa-store-joining-operator"
	const serviceKey = "ssssssssssssssssssssssss"
	const identityKey = "tttttttttttttttttttttttttttttttt"
	var permissionReads atomic.Int32
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+identityKey {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/internal/actors/") && strings.HasSuffix(r.URL.Path, "/roles/operator"):
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`, actor)
		case strings.HasPrefix(r.URL.Path, "/internal/operators/") && strings.HasSuffix(r.URL.Path, "/permissions/platform_policies"):
			permissionReads.Add(1)
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"permission":"platform_policies","enabled":false,"version":1,"reason":"test denied"}`, actor)
		default:
			http.NotFound(w, r)
		}
	}))
	defer identityServer.Close()
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := identityintegration.New(endpoint, identityKey)
	if err != nil {
		t.Fatal(err)
	}
	serviceAuth, err := auth.NewServiceToken(serviceKey)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=qa sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := &OperatorPolicyServer{auth: serviceAuth, identity: identity, db: db}
	mux := http.NewServeMux()
	s.Register(mux)
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/dsh/operator/store-joining-policies", ""},
		{"PUT", "/dsh/operator/store-joining-policies/INDEPENDENT_STORE", `{"enrollmentEnabled":false,"expectedVersion":1,"reason":"Test denied policy change"}`},
	} {
		request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		request.Header.Set("Authorization", "Bearer "+serviceKey)
		request.Header.Set("X-Acting-Actor-ID", actor)
		request.Header.Set("X-Correlation-ID", "corr-policy-permission-denied")
		request.Header.Set("Idempotency-Key", "idem-policy-permission-denied")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "FORBIDDEN") {
			t.Fatalf("operator without platform_policies could mutate/read: %s %d %s", tc.path, response.Code, response.Body.String())
		}
	}
	if permissionReads.Load() != 2 {
		t.Fatalf("permission reads=%d, want 2", permissionReads.Load())
	}
}
