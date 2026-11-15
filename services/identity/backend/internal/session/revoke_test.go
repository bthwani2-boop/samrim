package session

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type revokeReader struct {
	revoke func(context.Context, [32]byte) error
}

func (r revokeReader) Lookup(context.Context, [32]byte) (Principal, error) {
	panic("logout must not use an unprotected read-then-write check")
}

func (r revokeReader) Revoke(ctx context.Context, digest [32]byte) error {
	return r.revoke(ctx, digest)
}

func TestIdentityLogoutThroughOwnedSessionAndFailurePaths(t *testing.T) {
	token, digest := testToken(93)
	for _, tc := range []struct {
		name, method, path, authorization, body string
		duplicate                               bool
		revokeError                             error
		expectedStatus                          int
		expectedOwnerCalls                      int
	}{
		{"logout", "DELETE", "/v1/sessions/current", "Bearer " + token, "", false, nil, 204, 1},
		{"already revoked", "DELETE", "/v1/sessions/current", "Bearer " + token, "", false, ErrUnauthorized, 401, 1},
		{"owner unavailable", "DELETE", "/v1/sessions/current", "Bearer " + token, "", false, errors.New("database disconnected"), 503, 1},
		{"missing bearer", "DELETE", "/v1/sessions/current", "", "", false, nil, 401, 0},
		{"malformed bearer", "DELETE", "/v1/sessions/current", "Bearer bad", "", false, nil, 401, 0},
		{"duplicate bearer", "DELETE", "/v1/sessions/current", "Bearer " + token, "", true, nil, 401, 0},
		{"body", "DELETE", "/v1/sessions/current", "Bearer " + token, "{}", false, nil, 400, 0},
		{"query", "DELETE", "/v1/sessions/current?role=operator", "Bearer " + token, "", false, nil, 400, 0},
		{"permission delete forbidden", "DELETE", "/v1/operators/me/permissions/operations", "Bearer " + token, "", false, nil, 405, 0},
		{"session post forbidden", "POST", "/v1/sessions/current", "Bearer " + token, "", false, nil, 405, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			r := revokeReader{revoke: func(_ context.Context, actual [32]byte) error {
				calls++
				if actual != digest {
					t.Fatal("logout forwarded an incorrect credential digest")
				}
				return tc.revokeError
			}}
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.authorization != "" {
				request.Header.Add("Authorization", tc.authorization)
			}
			if tc.duplicate {
				request.Header.Add("Authorization", tc.authorization)
			}
			request.Header.Set("X-Actor-ID", "forged-other-account")
			request.Header.Set("X-Role", "operator")
			response := httptest.NewRecorder()
			NewHandler(NewVerifier(r)).ServeHTTP(response, request)
			if response.Code != tc.expectedStatus || calls != tc.expectedOwnerCalls {
				t.Fatalf("logout status=%d calls=%d expected=%d/%d: %s", response.Code, calls, tc.expectedStatus, tc.expectedOwnerCalls, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("logout exposed cacheable or browser cross-origin result")
			}
			if response.Code == http.StatusNoContent && response.Body.Len() != 0 {
				t.Fatal("logout must not include an actor, role or token")
			}
			if strings.Contains(response.Body.String(), token) || strings.Contains(response.Body.String(), "forged-other-account") {
				t.Fatal("logout exposed a credential or trusted a forged actor")
			}
		})
	}
}

func TestIdentityLogoutUnavailableWithoutCanonicalOwnerWriter(t *testing.T) {
	token, _ := testToken(94)
	for _, verifier := range []*Verifier{NewVerifier(nil), NewVerifier(readerFunc(func(context.Context, [32]byte) (Principal, error) {
		t.Fatal("read-only owner must not be consulted for logout")
		return Principal{}, nil
	}))} {
		request := httptest.NewRequest(http.MethodDelete, "/v1/sessions/current", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		result := httptest.NewRecorder()
		NewHandler(verifier).ServeHTTP(result, request)
		if result.Code != http.StatusServiceUnavailable {
			t.Fatalf("missing canonical revocation writer returned %d", result.Code)
		}
	}
}
