package session

import (
	"context"
	"database/sql"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRepositoryRefusesUnsafeOwnerScopes(t *testing.T) {
	if _, err := NewPostgresReader(nil, "identity_test_valid"); err == nil {
		t.Fatal("nil canonical owner database accepted")
	}
	for _, schema := range []string{"", "identity_test_.evil", "identity_test_a;drop schema dsh", "Identity_TEST_A", "identity_test_a--", "identity_test_a\"", "identity_test_a\n", "identity_test_" + strings.Repeat("x", 65), "public", "dsh_test_agent02_valid", "identity_protected"} {
		if _, err := NewPostgresReader(&sql.DB{}, schema); err == nil {
			t.Errorf("unsafe schema identifier accepted: %q", schema)
		}
	}
	if _, err := NewPostgresReader(&sql.DB{}, "identity_test_agent03_safe"); err != nil {
		t.Fatal("valid bounded owner scope rejected", err)
	}
}

func TestVerifierMissingOwnerFailsUnavailableWithoutActor(t *testing.T) {
	token, _ := testToken(14)
	_, err := NewVerifier(nil).Verify(context.Background(), "Bearer "+token)
	if err == nil || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("missing owner should fail as service error, got %v", err)
	}
	req := httptest.NewRequest("GET", "/v1/sessions/current", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	NewHandler(NewVerifier(nil)).ServeHTTP(rr, req)
	if rr.Code != 503 || strings.Contains(rr.Body.String(), "actorId") {
		t.Fatalf("unsafe missing-owner response: %d %s", rr.Code, rr.Body.String())
	}
}

func TestSessionEndpointRejectsBodyAndQuery(t *testing.T) {
	token, _ := testToken(15)
	v := NewVerifier(readerFunc(func(context.Context, [32]byte) (Principal, error) {
		t.Fatal("invalid session request must not access Identity owner")
		return Principal{}, nil
	}))
	for _, tt := range []struct{ target, body string }{{"/v1/sessions/current?role=operator", ""}, {"/v1/sessions/current", "{\"actorId\":\"other\"}"}} {
		req := httptest.NewRequest("GET", tt.target, strings.NewReader(tt.body))
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		NewHandler(v).ServeHTTP(rr, req)
		if rr.Code != 400 || strings.Contains(rr.Body.String(), "other") {
			t.Fatalf("unsafe request accepted: %d", rr.Code)
		}
	}
}

func TestSessionAndPermissionRejectDuplicateAuthorization(t *testing.T) {
	token, _ := testToken(62)
	reader := permissionReaderFunc{
		lookup: func(context.Context, [32]byte) (Principal, error) {
			t.Fatal("ambiguous Authorization reached session owner")
			return Principal{}, nil
		},
		permission: func(context.Context, [32]byte, string) (Principal, error) {
			t.Fatal("ambiguous Authorization reached permission owner")
			return Principal{}, nil
		},
	}
	for _, path := range []string{
		"/v1/sessions/current",
		"/v1/operators/me/permissions/operations",
	} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest("GET", path, nil)
			request.Header.Add("Authorization", "Bearer "+token)
			request.Header.Add("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			NewHandler(NewVerifier(reader)).ServeHTTP(response, request)
			if response.Code != 401 || response.Header().Get("WWW-Authenticate") == "" {
				t.Fatalf("duplicate bearer must fail 401: %d %s", response.Code, response.Body.String())
			}
		})
	}
}
