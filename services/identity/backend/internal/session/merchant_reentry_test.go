package session

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type merchantResumerFunc struct {
	resume func(context.Context, [32]byte) (MerchantAdmission, error)
}

func (m merchantResumerFunc) Lookup(context.Context, [32]byte) (Principal, error) {
	panic("merchant re-entry must check current owner state")
}

func (m merchantResumerFunc) ResumeMerchant(ctx context.Context, digest [32]byte) (MerchantAdmission, error) {
	return m.resume(ctx, digest)
}

func TestMerchantSessionReentryHTTPFailClosed(t *testing.T) {
	sourceToken, sourceDigest := testToken(101)
	newToken, _ := testToken(102)
	expires := time.Now().UTC().Add(29 * time.Minute).Truncate(time.Second)
	tests := []struct {
		name, method, path, authorization, body string
		duplicate                               bool
		resultError                             error
		status                                  int
		ownerCalls                              int
	}{
		{"active Merchant", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, nil, 200, 1},
		{"missing Merchant role", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, ErrMerchantNotActive, 403, 1},
		{"unverified Customer", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, ErrVerificationRequired, 403, 1},
		{"revoked or stale Customer", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, ErrUnauthorized, 401, 1},
		{"owner unavailable", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, errors.New("database down"), 503, 1},
		{"missing credential", "POST", "/v1/actors/me/merchant-session", "", "", false, nil, 401, 0},
		{"malformed credential", "POST", "/v1/actors/me/merchant-session", "Bearer invalid", "", false, nil, 401, 0},
		{"ambiguous credentials", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", true, nil, 401, 0},
		{"malicious actor body", "POST", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, `{"actorId":"operator"}`, false, nil, 400, 0},
		{"query injection", "POST", "/v1/actors/me/merchant-session?role=operator", "Bearer " + sourceToken, "", false, nil, 400, 0},
		{"GET denied", "GET", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, nil, 405, 0},
		{"DELETE denied", "DELETE", "/v1/actors/me/merchant-session", "Bearer " + sourceToken, "", false, nil, 405, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			reader := merchantResumerFunc{resume: func(_ context.Context, digest [32]byte) (MerchantAdmission, error) {
				calls++
				if digest != sourceDigest {
					t.Fatal("wrong signed-in source Customer")
				}
				return MerchantAdmission{AccessToken: newToken, SessionExpiresAt: expires}, tc.resultError
			}}
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.authorization != "" {
				req.Header.Add("Authorization", tc.authorization)
				if tc.duplicate {
					req.Header.Add("Authorization", tc.authorization)
				}
			}
			req.Header.Set("X-Actor-ID", "operator")
			req.Header.Set("X-Role", "operator")
			rec := httptest.NewRecorder()
			NewHandler(NewVerifier(reader)).ServeHTTP(rec, req)
			if rec.Code != tc.status || calls != tc.ownerCalls {
				t.Fatalf("got %d calls=%d want=%d calls=%d body=%s", rec.Code, calls, tc.status, tc.ownerCalls, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("unsafe credential response headers")
			}
			if tc.status != 200 {
				if strings.Contains(rec.Body.String(), newToken) || strings.Contains(rec.Body.String(), "operator") {
					t.Fatal("credential leak or forged actor assertion on error")
				}
				return
			}
			var out MerchantAdmission
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.AccessToken != newToken || !out.SessionExpiresAt.Equal(expires) {
				t.Fatalf("bad re-entry response %#v %v", out, err)
			}
		})
	}
}

func TestMerchantReentryRequiresOwnerWriter(t *testing.T) {
	token, _ := testToken(103)
	for _, v := range []*Verifier{NewVerifier(nil), NewVerifier(readerFunc(func(context.Context, [32]byte) (Principal, error) {
		t.Fatal("must not synthesize Merchant writer from session Reader")
		return Principal{}, nil
	}))} {
		req := httptest.NewRequest("POST", "/v1/actors/me/merchant-session", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		NewHandler(v).ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("missing writer allowed: %d", rec.Code)
		}
	}
}
