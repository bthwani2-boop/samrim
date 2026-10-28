package transporthttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func TestNewFieldFinanceRequiresAuthenticationAndDependencies(t *testing.T) {
	if _, err := NewFieldFinance(nil, "short", nil, nil); err == nil {
		t.Fatal("constructor accepted a missing service token")
	}
	if _, err := NewFieldFinance(nil, strings.Repeat("s", 24), nil, nil); err == nil || !strings.Contains(err.Error(), "Field finance dependencies are required") {
		t.Fatalf("constructor did not reject missing dependencies with its configuration error: %v", err)
	}
}

func newFieldFinanceValidationServer(t *testing.T) (*httptest.Server, *identityintegration.Client, *auth.ServiceToken, *http.ServeMux) {
	t.Helper()
	operatorToken := strings.Repeat("s", 24)
	activatedAt := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/auth/session":
			switch r.Header.Get("Authorization") {
			case "Bearer field-session":
				_ = json.NewEncoder(w).Encode(identityclient.ActorIdentity{Subject: "field-actor", Role: "field", Surface: "app-field"})
			case "Bearer wrong-field-surface":
				_ = json.NewEncoder(w).Encode(identityclient.ActorIdentity{Subject: "field-actor", Role: "field", Surface: "app-client"})
			case "Bearer partner-session":
				_ = json.NewEncoder(w).Encode(identityclient.ActorIdentity{Subject: "partner-actor", Role: "partner", Surface: "app-partner"})
			default:
				http.Error(w, `{"error":{"code":"UNAUTHENTICATED"}}`, http.StatusUnauthorized)
			}
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/internal/actors/") && strings.HasSuffix(r.URL.Path, "/roles/operator"):
			actorID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/internal/actors/"), "/roles/operator")
			_ = json.NewEncoder(w).Encode(identityclient.ActorRoleView{ActorID: actorID, Role: "operator", Enabled: true, SecurityEnabled: true, ActivatedAt: &activatedAt})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/internal/operators/") && strings.Contains(r.URL.Path, "/permissions/"):
			parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/internal/operators/"), "/permissions/")
			actorID := parts[0]
			permission := parts[1]
			_ = json.NewEncoder(w).Encode(identityclient.OperatorPermissionAccess{ActorID: actorID, Permission: identityclient.OperatorPermission(permission), Enabled: actorID != "restricted-operator", Version: 1})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(identityServer.Close)
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatalf("resolve identity test endpoint: %v", err)
	}
	identity, err := identityintegration.New(endpoint, operatorToken)
	if err != nil {
		t.Fatalf("create identity test client: %v", err)
	}
	serviceAuth, err := auth.NewServiceToken(operatorToken)
	if err != nil {
		t.Fatalf("create DSH test authorizer: %v", err)
	}
	mux := http.NewServeMux()
	(&FieldFinanceServer{auth: serviceAuth, identity: identity}).Register(mux)
	return identityServer, identity, serviceAuth, mux
}

func TestFieldFinanceRejectsInvalidPaginationAndActorScopes(t *testing.T) {
	_, _, _, mux := newFieldFinanceValidationServer(t)
	longActorID := strings.Repeat("f", 129)
	cases := []struct {
		name   string
		method string
		path   string
		field  string
		want   int
	}{
		{name: "operator case limit outside range", method: http.MethodGet, path: "/dsh/operator/fields/field-actor/acquisition-cases?limit=51", field: "operator", want: http.StatusBadRequest},
		{name: "operator case cursor too long", method: http.MethodGet, path: "/dsh/operator/fields/field-actor/acquisition-cases?cursor=" + strings.Repeat("c", 513), field: "operator", want: http.StatusBadRequest},
		{name: "operator summary actor too long", method: http.MethodGet, path: "/dsh/operator/fields/" + longActorID + "/financial-summary", field: "operator", want: http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.field == "field" {
				request.Header.Set("Authorization", "Bearer field-session")
			} else {
				request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 24))
				request.Header.Set("X-Acting-Actor-ID", "operator")
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("status: got %d, want %d; body=%s", response.Code, tc.want, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "INVALID_INPUT") {
				t.Fatalf("invalid input response did not preserve the API error contract: %s", response.Body.String())
			}
		})
	}
}

func TestFieldFinanceReadsCanonicalFieldAndOperatorSummaries(t *testing.T) {
	_, identity, serviceAuth, mux := newFieldFinanceValidationServer(t)
	wltServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || (r.URL.Path != "/wlt/v1/fields/field-actor/financial-summary" && r.URL.Path != "/wlt/v1/fields/operator/financial-summary") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"summary": map[string]any{"fieldActorId": strings.TrimPrefix(r.URL.Path, "/wlt/v1/fields/"), "currency": "YER", "earnedMinor": 1200, "entitlementMinor": 300, "partnerCount": 2}})
	}))
	t.Cleanup(wltServer.Close)
	payment, err := wlt.New(wltServer.URL, "test", strings.Repeat("w", 24))
	if err != nil {
		t.Fatalf("create WLT test client: %v", err)
	}
	server := &FieldFinanceServer{auth: serviceAuth, identity: identity, payment: payment}
	mux = http.NewServeMux()
	server.Register(mux)
	cases := []struct {
		name   string
		path   string
		auth   string
		acting string
	}{
		{name: "operator summary", path: "/dsh/operator/fields/operator/financial-summary", auth: "Bearer " + strings.Repeat("s", 24), acting: "operator"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tc.path, nil)
			request.Header.Set("Authorization", tc.auth)
			if tc.acting != "" {
				request.Header.Set("X-Acting-Actor-ID", tc.acting)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("summary status: got %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), `"currency":"YER"`) || !strings.Contains(response.Body.String(), `"earnedMinor":1200`) {
				t.Fatalf("summary did not preserve the canonical WLT values: %s", response.Body.String())
			}
		})
	}
}

func TestFieldFinanceRequiresFieldSessionAndOperatorAuthority(t *testing.T) {
	_, _, _, mux := newFieldFinanceValidationServer(t)
	serviceToken := "Bearer " + strings.Repeat("s", 24)
	cases := []struct {
		name   string
		path   string
		auth   string
		acting string
		want   int
	}{
		{name: "operator summary rejects service unauthenticated", path: "/dsh/operator/fields/field-actor/financial-summary", auth: "Bearer invalid", acting: "operator", want: http.StatusUnauthorized},
		{name: "operator summary requires actor", path: "/dsh/operator/fields/field-actor/financial-summary", auth: serviceToken, want: http.StatusBadRequest},
		{name: "operator summary requires finance permission", path: "/dsh/operator/fields/field-actor/financial-summary", auth: serviceToken, acting: "restricted-operator", want: http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tc.path, nil)
			if tc.auth != "" {
				request.Header.Set("Authorization", tc.auth)
			}
			if tc.acting != "" {
				request.Header.Set("X-Acting-Actor-ID", tc.acting)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("authority status: got %d, want %d; body=%s", response.Code, tc.want, response.Body.String())
			}
		})
	}
}
