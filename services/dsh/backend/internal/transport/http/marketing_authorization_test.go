package transporthttp

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
)

func TestMarketingContentOperatorRoutesRejectMissingMarketingPermission(t *testing.T) {
	const actorID = "marketing-denied-operator"
	const serviceToken = "ssssssssssssssssssssssss"
	const identityToken = "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"
	var permissionReads atomic.Int32
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+identityToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/roles/operator"):
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`, actorID)
		case strings.HasSuffix(r.URL.Path, "/permissions/marketing"):
			permissionReads.Add(1)
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"permission":"marketing","enabled":false,"version":1,"reason":"test unauthorized"}`, actorID)
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
	server, err := NewMarketingWithDependencies(identityClient, serviceToken, db, nil)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	cases := []struct{ name, method, path, body string }{
		{"list", "GET", "/dsh/operator/discovery-content", ""},
		{"summary", "GET", "/dsh/operator/marketing/summary", ""},
		{"studio draft read", "GET", "/dsh/operator/marketing/studio-draft", ""},
		{"studio draft write", "PUT", "/dsh/operator/marketing/studio-draft", `{"document":{}}`},
		{"analytics", "GET", "/dsh/operator/discovery-content/analytics?contentId=test", ""},
		{"create", "POST", "/dsh/operator/discovery-content", ""},
		{"publish", "POST", "/dsh/operator/discovery-content/test/publication", `{"state":"PUBLISHED"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer "+serviceToken)
			request.Header.Set("X-Acting-Actor-ID", actorID)
			request.Header.Set("X-Correlation-ID", "marketing-denial-"+tc.name)
			request.Header.Set("Idempotency-Key", "marketing-denial-"+tc.name)
			request.Header.Set("X-Expected-Version", "1")
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "FORBIDDEN") {
				t.Fatalf("%s without Marketing permission got %d: %s", tc.name, response.Code, response.Body.String())
			}
		})
	}
	if permissionReads.Load() != int32(len(cases)) {
		t.Fatalf("permission reads=%d, want %d", permissionReads.Load(), len(cases))
	}
	missingAuth := httptest.NewRequest("GET", "/dsh/operator/discovery-content", nil)
	missingAuth.Header.Set("X-Acting-Actor-ID", actorID)
	unauth := httptest.NewRecorder()
	mux.ServeHTTP(unauth, missingAuth)
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("service authentication missing: got %d", unauth.Code)
	}
}

func TestPartnerPromotionIdentityFailureClassification(t *testing.T) {
	const token = "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"
	for _, status := range []int{http.StatusUnauthorized, http.StatusServiceUnavailable} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":{"code":"IDENTITY_UNAVAILABLE","message":"identity service unavailable"}}`))
			}))
			defer identityServer.Close()
			endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
			if err != nil {
				t.Fatal(err)
			}
			identityClient, err := identityintegration.New(endpoint, token)
			if err != nil {
				t.Fatal(err)
			}
			server := &MarketingServer{identity: identityClient}
			_, err = server.partnerSessionActorID(context.Background(), "partner-access-token")
			if err == nil {
				t.Fatal("expected identity failure")
			}
			response := httptest.NewRecorder()
			writeMarketingError(response, err)
			want := http.StatusBadGateway
			if status == http.StatusUnauthorized {
				want = http.StatusUnauthorized
			}
			if response.Code != want {
				t.Fatalf("Identity %d returned %d, want %d: %s", status, response.Code, want, response.Body.String())
			}
		})
	}
}

func TestPartnerMarketingErrorsPreserveAuthorizationBoundary(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"no session", errPartnerPromotionSession, http.StatusUnauthorized, "UNAUTHENTICATED"},
		{"wrong Store owner", errPartnerPromotionStoreAuthority, http.StatusForbidden, "FORBIDDEN"},
		{"wrapped wrong Store owner", fmt.Errorf("store grant: %w", errPartnerPromotionStoreAuthority), http.StatusForbidden, "FORBIDDEN"},
		{"storage error", fmt.Errorf("database unavailable"), http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeMarketingError(response, tc.err)
			if response.Code != tc.status || !strings.Contains(response.Body.String(), `"`+tc.code+`"`) {
				t.Fatalf("error %v got %d: %s, expected %d %s", tc.err, response.Code, response.Body.String(), tc.status, tc.code)
			}
		})
	}
}
