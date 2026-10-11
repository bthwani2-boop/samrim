package transporthttp

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
)

func TestHRDirectoryRequiresExplicitHRGrantOnEveryPath(t *testing.T) {
	const (
		operator      = "act_hr_directory_denied_operator"
		serviceToken  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		identityToken = "iiiiiiiiiiiiiiiiiiiiiiiiiiii"
	)
	var readCount atomic.Int32
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+identityToken {
			http.Error(w, "invalid service identity", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/roles/operator"):
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`, operator)
		case strings.HasSuffix(r.URL.Path, "/permissions/hr"):
			readCount.Add(1)
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"permission":"hr","enabled":false,"version":1,"reason":"not granted"}`, operator)
		default:
			http.NotFound(w, r)
		}
	}))
	defer identityServer.Close()
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	identityClient, err := identityintegration.New(endpoint, identityToken)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=unused sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	server, err := NewHR(identityClient, serviceToken, db)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	cases := []struct{ name, method, path, body string }{
		{"directory", http.MethodGet, "/dsh/hr/employees", ""},
		{"detail", http.MethodGet, "/dsh/hr/employees/emp_a", ""},
		{"create", http.MethodPost, "/dsh/hr/employees", `{"fullNameAr":"Test","department":"Ops","jobTitle":"Agent","startDate":"2026-10-01","workLocation":"Sanaa"}`},
		{"access_queue", http.MethodGet, "/dsh/hr/access-requests", ""},
		{"access_details", http.MethodGet, "/dsh/hr/access-requests/hreq_00000000000000000000000000000000", ""},
		{"access_submit", http.MethodPost, "/dsh/hr/access-requests", `{"employeeId":"emp_00000000000000000000000000000000","reason":"Needs workspace access","requestedPermissions":["operations"]}`},
		{"access_link", http.MethodPost, "/dsh/hr/access-requests/hreq_00000000000000000000000000000000/link", `{"operatorProfileId":"oprof_123"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer "+serviceToken)
			req.Header.Set("X-Acting-Actor-ID", operator)
			req.Header.Set("X-Correlation-ID", "corr-hr-denial")
			req.Header.Set("Idempotency-Key", "idem-hr-denial")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != 403 {
				t.Fatalf("expected 403 without HR permission, got %d: %s", res.Code, res.Body.String())
			}
		})
	}
	if readCount.Load() != int32(len(cases)) {
		t.Fatalf("HR permission looked up %d times for %d endpoints", readCount.Load(), len(cases))
	}
	for _, tc := range cases {
		t.Run(tc.name+"_unauthenticated", func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), tc.method, tc.path, nil)
			req.Header.Set("X-Acting-Actor-ID", operator)
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != 401 {
				t.Fatalf("expected 401 without service token, got %d", res.Code)
			}
		})
	}
}
