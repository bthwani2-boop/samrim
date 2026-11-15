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

type merchantAdmitterFunc struct {
	admit func(context.Context, [32]byte) (MerchantAdmission, error)
}

func (m merchantAdmitterFunc) Lookup(context.Context, [32]byte) (Principal, error) {
	panic("merchant admission must validate Identity state inside the owner transaction")
}
func (m merchantAdmitterFunc) AdmitMerchant(ctx context.Context, digest [32]byte) (MerchantAdmission, error) {
	return m.admit(ctx, digest)
}

func TestMerchantDirectAdmissionHTTPFailClosed(t *testing.T) {
	customerToken, customerDigest := testToken(96)
	merchantToken, _ := testToken(97)
	expires := time.Now().UTC().Add(30 * time.Minute)
	cases := []struct {
		name, method, path, auth, body string
		duplicate                      bool
		ownerError                     error
		status                         int
		calls                          int
	}{
		{"verified customer", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, nil, 201, 1},
		{"existing active or suspended merchant", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, ErrMerchantAlreadyProvisioned, 409, 1},
		{"verification missing", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, ErrVerificationRequired, 403, 1},
		{"stale actor", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, ErrUnauthorized, 401, 1},
		{"owner unavailable", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, errors.New("pg unavailable"), 503, 1},
		{"missing bearer", http.MethodPost, "/v1/actors/me/merchant-role", "", "", false, nil, 401, 0},
		{"invalid bearer", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer nope", "", false, nil, 401, 0},
		{"ambiguous bearers", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", true, nil, 401, 0},
		{"body rejected", http.MethodPost, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "{\"role\":\"operator\"}", false, nil, 400, 0},
		{"query rejected", http.MethodPost, "/v1/actors/me/merchant-role?actorId=other", "Bearer " + customerToken, "", false, nil, 400, 0},
		{"GET rejected", http.MethodGet, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, nil, 405, 0},
		{"PUT rejected", http.MethodPut, "/v1/actors/me/merchant-role", "Bearer " + customerToken, "", false, nil, 405, 0},
		{"operator path not exposed", http.MethodPost, "/v1/actors/me/operator-role", "Bearer " + customerToken, "", false, nil, 404, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			owner := merchantAdmitterFunc{admit: func(_ context.Context, digest [32]byte) (MerchantAdmission, error) {
				calls++
				if digest != customerDigest {
					t.Fatal("admission used the wrong source credential digest")
				}
				return MerchantAdmission{AccessToken: merchantToken, SessionExpiresAt: expires}, tc.ownerError
			}}
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.auth != "" {
				req.Header.Add("Authorization", tc.auth)
				if tc.duplicate {
					req.Header.Add("Authorization", tc.auth)
				}
			}
			req.Header.Set("X-Actor-ID", "other-actor")
			req.Header.Set("X-Role", "operator")
			rec := httptest.NewRecorder()
			NewHandler(NewVerifier(owner)).ServeHTTP(rec, req)
			if rec.Code != tc.status || calls != tc.calls {
				t.Fatalf("status=%d calls=%d expected=%d/%d body=%s", rec.Code, calls, tc.status, tc.calls, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("admission response is cacheable or cross-origin")
			}
			if rec.Code != http.StatusCreated {
				if strings.Contains(rec.Body.String(), merchantToken) || strings.Contains(rec.Body.String(), "other-actor") {
					t.Fatal("failure leaked a credential or trusted caller assertion")
				}
				return
			}
			var result MerchantAdmission
			if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
				t.Fatal("invalid admission response", err)
			}
			if result.AccessToken != merchantToken || !result.SessionExpiresAt.Equal(expires) {
				t.Fatalf("invalid merchant scoped session: %#v", result)
			}
		})
	}
}

func TestMerchantAdmissionRequiresCanonicalWriter(t *testing.T) {
	token, _ := testToken(98)
	for _, v := range []*Verifier{NewVerifier(nil), NewVerifier(readerFunc(func(context.Context, [32]byte) (Principal, error) {
		t.Fatal("a read-only lookup must not issue new Identity roles or credentials")
		return Principal{}, nil
	}))} {
		req := httptest.NewRequest(http.MethodPost, "/v1/actors/me/merchant-role", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		NewHandler(v).ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("unavailable canonical writer returned %d", rec.Code)
		}
	}
}
