package session

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type permissionReaderFunc struct {
	lookup     func(context.Context, [32]byte) (Principal, error)
	permission func(context.Context, [32]byte, string) (Principal, error)
}

func (p permissionReaderFunc) Lookup(ctx context.Context, digest [32]byte) (Principal, error) {
	return p.lookup(ctx, digest)
}
func (p permissionReaderFunc) LookupPermission(ctx context.Context, digest [32]byte, scope string) (Principal, error) {
	return p.permission(ctx, digest, scope)
}

func TestOperatorPermissionEndpointFailClosed(t *testing.T) {
	token, digest := testToken(51)
	valid := Principal{ActorID: "operator-synthetic-one", Role: "operator", ExpiresAt: time.Now().UTC().Add(time.Hour)}
	for _, test := range []struct {
		name, path, method, auth string
		ownerErr                 error
		ownerRole                string
		expected                 int
		noOwner                  bool
	}{
		{"granted", "/v1/operators/me/permissions/operations", "GET", "Bearer " + token, nil, "operator", 200, false},
		{"missing credential", "/v1/operators/me/permissions/operations", "GET", "", nil, "operator", 401, true},
		{"forged credential", "/v1/operators/me/permissions/operations", "GET", "Bearer invalid", nil, "operator", 401, true},
		{"permission revoked", "/v1/operators/me/permissions/operations", "GET", "Bearer " + token, ErrForbidden, "operator", 403, false},
		{"operator role alone does not grant", "/v1/operators/me/permissions/operations", "GET", "Bearer " + token, nil, "merchant", 403, false},
		{"owner unavailable", "/v1/operators/me/permissions/operations", "GET", "Bearer " + token, errors.New("database disconnected"), "operator", 503, false},
		{"unknown permission", "/v1/operators/me/permissions/custom", "GET", "Bearer " + token, nil, "operator", 404, true},
		{"invalid method", "/v1/operators/me/permissions/operations", "POST", "Bearer " + token, nil, "operator", 405, true},
		{"unknown path", "/v1/operators/me/permissions/operations/extra", "GET", "Bearer " + token, nil, "operator", 404, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			owner := permissionReaderFunc{
				lookup: func(context.Context, [32]byte) (Principal, error) {
					t.Fatal("must use owner-scoped permission lookup")
					return Principal{}, nil
				},
				permission: func(_ context.Context, actual [32]byte, scope string) (Principal, error) {
					calls++
					if actual != digest || scope != "operations" {
						t.Fatalf("unexpected permission request %x, %q", actual, scope)
					}
					if test.ownerErr != nil {
						return Principal{}, test.ownerErr
					}
					p := valid
					p.Role = test.ownerRole
					return p, nil
				},
			}
			req := httptest.NewRequest(test.method, test.path, nil)
			if test.auth != "" {
				req.Header.Set("Authorization", test.auth)
			}
			req.Header.Set("X-Actor-ID", "operator-synthetic-other")
			req.Header.Set("X-Role", "operator")
			recorder := httptest.NewRecorder()
			NewHandler(NewVerifier(owner)).ServeHTTP(recorder, req)
			if recorder.Code != test.expected {
				t.Fatalf("status %d not %d: %s", recorder.Code, test.expected, recorder.Body.String())
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("permission result must never be cacheable")
			}
			if strings.Contains(recorder.Body.String(), token) || strings.Contains(recorder.Body.String(), "operator-synthetic-other") {
				t.Fatal("credential or forged header leaked")
			}
			if test.noOwner && calls != 0 {
				t.Fatal("invalid request queried owner")
			}
			if test.expected == 200 && (!strings.Contains(recorder.Body.String(), `"actorId":"operator-synthetic-one"`) || !strings.Contains(recorder.Body.String(), `"permission":"operations"`)) {
				t.Fatalf("permission approval missing authoritative actor: %s", recorder.Body.String())
			}
		})
	}
}
func TestPermissionRequestRejectsBodyAndQuery(t *testing.T) {
	token, _ := testToken(55)
	o := permissionReaderFunc{
		lookup: func(context.Context, [32]byte) (Principal, error) {
			t.Fatal("unexpected session read")
			return Principal{}, nil
		},
		permission: func(context.Context, [32]byte, string) (Principal, error) {
			t.Fatal("invalid request reached owner")
			return Principal{}, nil
		},
	}
	for _, r := range []struct{ path, body string }{
		{"/v1/operators/me/permissions/operations?actorId=other", ""},
		{"/v1/operators/me/permissions/operations", `{"role":"operator"}`},
	} {
		req := httptest.NewRequest("GET", r.path, strings.NewReader(r.body))
		req.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		NewHandler(NewVerifier(o)).ServeHTTP(recorder, req)
		if recorder.Code != 400 {
			t.Fatalf("invalid permission request accepted: %d", recorder.Code)
		}
	}
}
func TestOperatorPermissionRejectsStreamingBody(t *testing.T) {
	token, _ := testToken(66)
	owner := permissionReaderFunc{
		lookup: func(context.Context, [32]byte) (Principal, error) {
			t.Fatal("unexpected session owner read")
			return Principal{}, nil
		},
		permission: func(context.Context, [32]byte, string) (Principal, error) {
			t.Fatal("chunked request reached privileged Identity owner")
			return Principal{}, nil
		},
	}
	req := httptest.NewRequest("GET", "/v1/operators/me/permissions/operations", strings.NewReader(`{"actorId":"other"}`))
	req.ContentLength = -1
	req.TransferEncoding = []string{"chunked"}
	req.Header.Set("Authorization", "Bearer "+token)
	result := httptest.NewRecorder()
	NewHandler(NewVerifier(owner)).ServeHTTP(result, req)
	if result.Code != 400 {
		t.Fatalf("streaming body was not rejected: status=%d", result.Code)
	}
}

func TestOnlyFiniteOwnerPermissions(t *testing.T) {
	want := []string{"operations", "merchant", "catalog", "marketing", "finance", "hr", "platform_policies"}
	for _, s := range want {
		if !isOperatorPermission(s) {
			t.Fatalf("approved scope rejected: %s", s)
		}
	}
	for _, s := range []string{"", "partners", "all", "admin", "root", "SUPERUSER", "permission:finance", "operations/other", " finance", "financial_execution"} {
		if isOperatorPermission(s) {
			t.Fatalf("unapproved permission accepted: %s", s)
		}
	}
}

func TestOperatorPermissionInvalidOwnerSessionIsUnauthorized(t *testing.T) {
	token, _ := testToken(91)
	owner := permissionReaderFunc{
		lookup: func(context.Context, [32]byte) (Principal, error) {
			t.Fatal("unexpected current session lookup")
			return Principal{}, nil
		},
		permission: func(context.Context, [32]byte, string) (Principal, error) {
			return Principal{ActorID: "operator-synthetic-expired", Role: "operator", ExpiresAt: time.Now().UTC().Add(-time.Minute)}, nil
		},
	}
	request := httptest.NewRequest("GET", "/v1/operators/me/permissions/operations", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	NewHandler(NewVerifier(owner)).ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatalf("invalid Identity principal must return unauthorized, got %d: %s", response.Code, response.Body.String())
	}
}
