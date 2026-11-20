package wallet

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWalletReadRequiresCurrentUncachedCustomer(t *testing.T) {
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	const session = `{"actorId":"verified-customer","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	for _, scenario := range []struct {
		name, cache, principal string
		identityStatus, status int
	}{
		{"verified", "no-store", session, 200, 200},
		{"revoked", "no-store", "", 401, 401},
		{"unknown owner", "no-store", "", 503, 503},
		{"cached", "max-age=60", session, 200, 503},
		{"merchant role", "no-store", strings.Replace(session, `"customer"`, `"merchant"`, 1), 200, 403},
		{"wrong shape", "no-store", `{"actorId":"verified-customer"}`, 200, 503},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/v1/sessions/current" || r.Header.Get("Authorization") != token {
					t.Error("WLT request diverged from the Identity session contract")
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", scenario.cache)
				w.WriteHeader(scenario.identityStatus)
				_, _ = w.Write([]byte(scenario.principal))
			}))
			defer identity.Close()
			reads := 0
			handler, err := newHandler(identity.URL, func(_ context.Context, actor string) (string, error) {
				reads++
				if actor != "verified-customer" {
					t.Errorf("request-supplied actor used for ledger read: %q", actor)
				}
				return "9007199254740993", nil
			})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("GET", "/v1/wallets/me", nil)
			req.Header.Set("Authorization", token)
			req.Header.Set("X-Actor-ID", "caller-claims-another-actor")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != scenario.status || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("unexpected wallet read %d: %s", rec.Code, rec.Body.String())
			}
			if scenario.status == 200 {
				if reads != 1 || !strings.Contains(rec.Body.String(), `"balanceYer":"9007199254740993"`) {
					t.Fatal("exact result from the authorized owner was not returned")
				}
			} else if reads != 0 || strings.Contains(rec.Body.String(), "balanceYer") {
				t.Fatal("an unauthorized request read or disclosed the financial projection")
			}
			mutation := httptest.NewRecorder()
			handler.ServeHTTP(mutation, httptest.NewRequest("POST", "/v1/wallets/me", nil))
			if mutation.Code != 405 {
				t.Error("read-only wallet admitted a mutation")
			}
		})
	}
}
