package wallet

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestContainerIdentityRequiresExplicitTrustedService(t *testing.T) {
	if _, err := newIdentityReader("http://identity:3302"); err == nil {
		t.Fatal("local reader trusted container hostname")
	}
	if reader, err := newIdentityReader("http://identity:3302", true); err != nil ||
		reader.endpoint != "http://identity:3302/v1/sessions/current" {
		t.Fatalf("explicit container service origin denied: %v", err)
	}
	for _, candidate := range []string{
		"http://identity:3303", "https://identity:3302",
		"http://identity:3302/elsewhere", "http://identity.evil:3302",
		"http://user@identity:3302", "http://identity:3302?redirect=1",
		"http://127.0.0.1:3302",
	} {
		if _, err := newIdentityReader(candidate, true); err == nil && candidate != "http://127.0.0.1:3302" {
			t.Fatalf("unexpected container trust: %s", candidate)
		}
	}
}

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

func TestWalletDiscardsBalanceOnOwnerChangeDuringRead(t *testing.T) {
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	const session = `{"actorId":"verified-customer","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	for _, scenario := range []struct {
		name, nextSession string
		identity, want    int
	}{
		{"revoked", "", http.StatusUnauthorized, http.StatusUnauthorized},
		{"owner unavailable", "", http.StatusServiceUnavailable, http.StatusServiceUnavailable},
		{"different actor", strings.Replace(session, "verified-customer", "other-customer", 1), http.StatusOK, http.StatusUnauthorized},
		{"role changed", strings.Replace(session, `"customer"`, `"merchant"`, 1), http.StatusOK, http.StatusForbidden},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var calls atomic.Int32
			identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "no-store")
				if calls.Add(1) == 1 {
					_, _ = w.Write([]byte(session))
					return
				}
				w.WriteHeader(scenario.identity)
				_, _ = w.Write([]byte(scenario.nextSession))
			}))
			defer identity.Close()
			handler, err := newHandler(identity.URL, func(context.Context, string) (string, error) {
				return "100", nil
			})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("GET", "/v1/wallets/me", nil)
			req.Header.Set("Authorization", token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if calls.Load() != 2 || response.Code != scenario.want || strings.Contains(response.Body.String(), "balanceYer") {
				t.Fatalf("expected undisclosed balance after owner change: %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestFundingHistoryRequiresCurrentCustomerAndNeverLeaksOnChange(t *testing.T) {
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32))
	const customer = `{"actorId":"wallet-one","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	const another = `{"actorId":"wallet-two","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	const merchant = `{"actorId":"wallet-one","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	for _, tc := range []struct {
		name, first, next string
		want              int
		reads             int
	}{
		{"authorized", customer, customer, 200, 1},
		{"switch actor", customer, another, 401, 1},
		{"switch role", customer, merchant, 403, 1},
		{"merchant first", merchant, merchant, 403, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				if calls.Add(1) == 1 {
					_, _ = w.Write([]byte(tc.first))
				} else {
					_, _ = w.Write([]byte(tc.next))
				}
			}))
			defer owner.Close()
			reads := 0
			handler, err := newHandlerWithHistory(owner.URL,
				func(context.Context, string) (string, error) { return "0", nil },
				func(_ context.Context, actor string, _ *historyCursor) (fundingHistory, error) {
					reads++
					if actor != "wallet-one" {
						t.Errorf("wrong actor: %s", actor)
					}
					return fundingHistory{ActorID: actor, Currency: "YER", Items: []fundingTransaction{
						{FundingID: "funding-0001", AmountYER: "9", PostedAt: time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)},
					}}, nil
				})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodGet, "/v1/wallets/me/transactions", nil)
			request.Header.Set("Authorization", token)
			request.Header.Set("X-Actor-ID", "wallet-two")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.want || reads != tc.reads {
				t.Fatalf("history HTTP=%d reads=%d body=%s", response.Code, reads, response.Body.String())
			}
			if tc.want == 200 {
				if calls.Load() != 2 || !strings.Contains(response.Body.String(), `"fundingId":"funding-0001"`) {
					t.Fatalf("funding projection not read after two checks: %s", response.Body.String())
				}
			} else if strings.Contains(response.Body.String(), "funding-0001") {
				t.Fatal("history leaked across principal change")
			}
		})
	}
}

func TestFundingHistoryRejectsActorSelectionAndWrites(t *testing.T) {
	identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"actorId":"wallet-one","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`))
	}))
	defer identity.Close()
	handler, err := newHandlerWithHistory(identity.URL,
		func(context.Context, string) (string, error) { return "0", nil },
		func(context.Context, string, *historyCursor) (fundingHistory, error) {
			t.Fatal("untrusted history input reached the owner")
			return fundingHistory{}, nil
		})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{"GET", "/v1/wallets/me/transactions?actorId=wallet-two", 400},
		{"POST", "/v1/wallets/me/transactions", 405},
		{"GET", "/v1/wallets/me/transactions", 401},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
		if response.Code != tc.want {
			t.Errorf("%s %s: %d", tc.method, tc.path, response.Code)
		}
	}
}

func TestFundingHistoryCursorIsCanonicalAndCannotSelectAnActor(t *testing.T) {
	item := fundingTransaction{FundingID: "funding-0001", AmountYER: "9",
		PostedAt: time.Date(2026, 11, 20, 1, 2, 3, 123456000, time.UTC)}
	encoded := makeHistoryCursor(item)
	cursor, err := parseHistoryCursor("cursor=" + encoded)
	if err != nil || cursor == nil || cursor.fundingID != item.FundingID ||
		!cursor.postedAt.Equal(item.PostedAt) {
		t.Fatalf("canonical cursor failed roundtrip: %+v %v", cursor, err)
	}
	empty, err := parseHistoryCursor("")
	if err != nil || empty != nil {
		t.Fatalf("first page must not require a cursor: %+v %v", empty, err)
	}
	malformed := []string{
		"actorId=wallet-two", "cursor=", "cursor=!",
		"cursor=" + encoded + "&actorId=wallet-two",
		"cursor=" + encoded + "&cursor=" + encoded,
		"cursor=" + strings.Repeat("x", 241),
		"cursor=" + base64.RawURLEncoding.EncodeToString([]byte("2026-11-20T01:02:03+03:00|funding-0001")),
		"cursor=" + base64.RawURLEncoding.EncodeToString([]byte("2026-11-20T01:02:03Z|short")),
		"cursor=" + base64.RawURLEncoding.EncodeToString([]byte("not-a-time|funding-0001")),
	}
	for _, raw := range malformed {
		if parsed, err := parseHistoryCursor(raw); err == nil || parsed != nil {
			t.Errorf("noncanonical actor/page selector admitted: %q: %+v %v", raw, parsed, err)
		}
	}
}
