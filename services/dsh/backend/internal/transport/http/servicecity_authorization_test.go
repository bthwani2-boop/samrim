package transporthttp

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	_ "github.com/lib/pq"
)

func TestServiceCityWritesRequirePlatformPoliciesPermission(t *testing.T) {
	const (
		actorID     = "act_operator_city_authorization_test"
		serviceKey  = "ssssssssssssssssssssssss"
		identityKey = "tttttttttttttttttttttttttttttttt"
	)
	permissionReads := 0
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+identityKey {
			http.Error(w, "unauthorized test identity request", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/internal/actors/") && strings.HasSuffix(r.URL.Path, "/roles/operator"):
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`, actorID)
		case strings.HasPrefix(r.URL.Path, "/internal/operators/") && strings.HasSuffix(r.URL.Path, "/permissions/platform_policies"):
			permissionReads++
			_, _ = fmt.Fprintf(w, `{"actorId":%q,"permission":"platform_policies","enabled":false,"version":1,"reason":"test denied"}`, actorID)
		default:
			http.NotFound(w, r)
		}
	}))
	defer identityServer.Close()

	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatalf("validate isolated Identity endpoint: %v", err)
	}
	identityClient, err := identityintegration.New(endpoint, identityKey)
	if err != nil {
		t.Fatalf("create isolated Identity client: %v", err)
	}
	db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=codex sslmode=disable connect_timeout=1")
	if err != nil {
		t.Fatalf("open unreachable PostgreSQL handle: %v", err)
	}
	defer db.Close()
	server, err := NewServiceCity(identityClient, serviceKey, db)
	if err != nil {
		t.Fatalf("create ServiceCity API: %v", err)
	}
	mux := http.NewServeMux()
	server.Register(mux)

	requests := []struct {
		name, method, path, body, correlationID, idempotencyKey string
		expectedVersion                                         string
	}{
		{name: "create", method: http.MethodPost, path: "/dsh/service-cities", body: `{"displayNameAr":"صنعاء","active":true}`, correlationID: "corr-service-city-denied-create", idempotencyKey: "idem-service-city-denied-create"},
		{name: "update", method: http.MethodPatch, path: "/dsh/service-cities/city_existing", body: `{"displayNameAr":"صنعاء","active":false}`, correlationID: "corr-service-city-denied-update", idempotencyKey: "idem-service-city-denied-update", expectedVersion: "1"},
	}
	for _, testCase := range requests {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(testCase.body))
			request.Header.Set("Authorization", "Bearer "+serviceKey)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Acting-Actor-ID", actorID)
			request.Header.Set("X-Correlation-ID", testCase.correlationID)
			request.Header.Set("Idempotency-Key", testCase.idempotencyKey)
			if testCase.expectedVersion != "" {
				request.Header.Set("X-Expected-Version", testCase.expectedVersion)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "FORBIDDEN") {
				t.Fatalf("write without Platform Policies permission got %d %s, want 403 FORBIDDEN", response.Code, response.Body.String())
			}
		})
	}
	if permissionReads != len(requests) {
		t.Fatalf("Platform Policies authorization reads=%d, want one for each write", permissionReads)
	}
}
