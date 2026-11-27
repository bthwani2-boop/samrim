package wallet

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
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
		{"duplicate actor", "no-store", `{"actorId":"other","actorId":"verified-customer","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200, 503},
		{"case variant role", "no-store", `{"actorId":"verified-customer","Role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200, 503},
		{"duplicate role", "no-store", `{"actorId":"verified-customer","role":"merchant","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200, 503},
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
			handler, err := newHandler(identity.URL, func(_ context.Context, actor string) (walletAmounts, error) {
				reads++
				if actor != "verified-customer" {
					t.Errorf("request-supplied actor used for ledger read: %q", actor)
				}
				return walletAmounts{"9007199254740993", "9007199254740992"}, nil
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
			handler, err := newHandler(identity.URL, func(context.Context, string) (walletAmounts, error) {
				return walletAmounts{"100", "100"}, nil
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
				func(context.Context, string) (walletAmounts, error) { return walletAmounts{"0", "0"}, nil },
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
		func(context.Context, string) (walletAmounts, error) { return walletAmounts{"0", "0"}, nil },
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

func TestOwnerTransportRejectsAmbientProxy(t *testing.T) {
	// Start a fresh test process because Go caches the ambient proxy config.
	const child = "BTHWANI_TEST_OWNER_PROXY_CHILD"
	if os.Getenv(child) != "1" {
		cmd := exec.CommandContext(t.Context(), os.Args[0], "-test.run=^TestOwnerTransportRejectsAmbientProxy$", "-test.v")
		cmd.Env = append(os.Environ(), child+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated owner transport failed: %v\n%s", err, output)
		}
		return
	}
	var proxied atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		proxied.Add(1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer proxy.Close()
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("http_proxy", proxy.URL)
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
	t.Setenv("REQUEST_METHOD", "")
	const session = `{"actorId":"merchant-one","role":"merchant","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	const standing = `{"actorId":"merchant-one","stores":[{"id":"store-a","name":"Shop","relation":"DIRECT","published":true}]}`
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{6}, 32))
	var ownerCalls atomic.Int32
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != token {
			t.Error("missing synthetic session")
		}
		ownerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		switch r.URL.Path {
		case "/v1/sessions/current":
			_, _ = w.Write([]byte(session))
		case "/v1/stores/mine":
			_, _ = w.Write([]byte(standing))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer owner.Close()
	reader, err := newIdentityReader("http://identity:3302", true)
	if err != nil {
		t.Fatal(err)
	}
	transport := reader.client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	tr, ok := transport.(*http.Transport)
	if !ok {
		t.Fatal("expected native HTTP transport")
	}
	// Map only the admitted container hostnames to a real local socket.
	// Keep the actual transport's proxy decision, but prevent external DNS/dials.
	tr = tr.Clone()
	defer tr.CloseIdleConnections()
	ownerAddr := strings.TrimPrefix(owner.URL, "http://")
	proxyAddr := strings.TrimPrefix(proxy.URL, "http://")
	tr.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		switch addr {
		case "identity:3302", "dsh:8080":
			addr = ownerAddr
		case proxyAddr:
		default:
			return nil, &net.AddrError{Err: "unexpected isolated destination", Addr: addr}
		}
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	reader.client.Transport = tr
	actor, status := reader.readRole(t.Context(), token, "merchant")
	relation, standingStatus := ownedStoreRelation(t.Context(), reader, "http://dsh:8080/v1/stores/mine", token, "merchant-one", "store-a")
	if status != http.StatusOK || actor.ActorID != "merchant-one" ||
		standingStatus != http.StatusOK || relation != "DIRECT" || ownerCalls.Load() != 2 || proxied.Load() != 0 {
		t.Fatalf("owner transport escaped direct routing: session=%d standing=%d direct=%d proxied=%d", status, standingStatus, ownerCalls.Load(), proxied.Load())
	}
}

func TestFinanceRejectsAmbiguousGrantBeforeRead(t *testing.T) {
	const session = `{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	for _, body := range []string{
		`{"actorId":"operator-a","permission":"operations","permission":"finance"}`,
		`{"actorId":"operator-b","actorId":"operator-a","permission":"finance"}`,
		`{"actorId":"operator-a","Permission":"finance"}`,
		`{"actorId":"operator-a","permission":null}`,
		`{"actorId":"operator-a"}`,
	} {
		t.Run(body, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/v1/sessions/current" {
					_, _ = w.Write([]byte(session))
					return
				}
				_, _ = w.Write([]byte(body))
			}))
			defer owner.Close()
			reader, err := newIdentityReader(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
			if _, status := reader.finance(t.Context(), token); status != 503 {
				t.Fatalf("malformed grant status=%d", status)
			}
		})
	}
}

func TestMerchantStandingRejectsAmbiguousOwnerWire(t *testing.T) {
	for _, body := range []string{
		`{"actorId":"other","actorId":"merchant-one","stores":[{"id":"store-a","name":"Shop","relation":"DIRECT","published":true}]}`,
		`{"actorId":"merchant-one","stores":[{"id":"store-a","name":"Shop","relation":"MARKETPLACE","relation":"DIRECT","published":true}]}`,
		`{"actorId":"merchant-one","Stores":[{"id":"store-a","name":"Shop","relation":"DIRECT","published":true}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			defer owner.Close()
			reader, err := newIdentityReader(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
			if relation, status := ownedStoreRelation(t.Context(), reader, owner.URL+"/v1/stores/mine", token, "merchant-one", "store-a"); relation != "" || status != 503 {
				t.Fatalf("malformed standing status=%d relation=%s", status, relation)
			}
		})
	}
}

func TestFinanceOwnerDecisionAndRecovery(t *testing.T) {
	const session = `{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	for _, tc := range []struct {
		name                             string
		sessionStatus, grantStatus, want int
		grant                            string
	}{
		{"valid", 200, 200, 200, `{"actorId":"operator-a","permission":"finance"}`},
		{"revoked session", 401, 200, 401, ""},
		{"revoked permission", 200, 403, 403, ""},
		{"foreign actor", 200, 200, 403, `{"actorId":"other","permission":"finance"}`},
		{"wrong permission", 200, 200, 403, `{"actorId":"operator-a","permission":"operations"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == sessionPath {
					w.WriteHeader(tc.sessionStatus)
					_, _ = w.Write([]byte(session))
					return
				}
				if r.URL.Path != financePermissionPath {
					t.Error("unexpected permission path")
				}
				w.WriteHeader(tc.grantStatus)
				_, _ = w.Write([]byte(tc.grant))
			}))
			defer owner.Close()
			reader, err := newIdentityReader(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			actor, status := reader.finance(t.Context(), token)
			if status != tc.want || (status == 200 && actor.ActorID != "operator-a") || (status != 200 && actor.ActorID != "") {
				t.Fatalf("incorrect finance decision: status=%d actor=%+v", status, actor)
			}
		})
	}
}

func TestOwnerReadRejectsInvalidTransportInputs(t *testing.T) {
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	if _, status := (identityReader{}).read(t.Context(), token); status != 503 {
		t.Fatal(status)
	}
	if _, status := (identityReader{}).read(t.Context(), "invalid"); status != 401 {
		t.Fatal(status)
	}
	reader, err := newIdentityReader("http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	reader.endpoint = "http://["
	if _, status := reader.read(t.Context(), token); status != 503 {
		t.Fatal(status)
	}
	for _, tc := range []struct {
		name, body string
		stream     bool
	}{
		{"oversize advertised", strings.Repeat("a", 4097), false},
		{"oversize streamed", strings.Repeat("a", 4097), true},
		{"invalid unicode", `{"actorId":"operator-\ud800","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				if tc.stream {
					w.(http.Flusher).Flush()
				}
				_, _ = w.Write([]byte(tc.body))
			}))
			defer owner.Close()
			reader, err := newIdentityReader(owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			if actor, status := reader.read(t.Context(), token); status != 503 || actor.ActorID != "" {
				t.Fatalf("invalid response admitted %v %d", actor, status)
			}
		})
	}
}

func TestOwnerJSONWireAdmission(t *testing.T) {
	const body = `{"actorId":"wallet-one","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	for _, encoding := range []string{"", "identity", "unknown", "gzip", "identity, unknown"} {
		t.Run("encoding="+encoding, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "no-store")
				if encoding != "" {
					w.Header().Set("Content-Encoding", encoding)
				}
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			reader, err := newIdentityReader(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			_, status := reader.read(t.Context(), token)
			want := http.StatusServiceUnavailable
			if encoding == "" || encoding == "identity" {
				want = http.StatusOK
			}
			if status != want {
				t.Fatalf("encoding %q: status=%d want=%d", encoding, status, want)
			}
		})
	}
}

func TestOwnerJSONNormalizedFrame(t *testing.T) {
	const body = "{}"
	for _, tc := range []struct {
		name, payload string
		length        int64
		transfer      []string
		uncompressed  bool
		want          bool
	}{
		{"exact", body, 2, nil, false, true},
		{"unknown", body, -1, nil, false, true},
		{"chunked", body, -1, []string{"chunked"}, false, true},
		{"zero", body, 0, nil, false, false},
		{"short", body, 1, nil, false, false},
		{"long", body, 3, nil, false, false},
		{"contradictory", body, 2, []string{"chunked"}, false, false},
		{"unsupported transfer", body, -1, []string{"gzip"}, false, false},
		{"decoded", body, -1, nil, true, false},
		{"null", "null", 4, nil, false, false},
		{"array", "[]", 2, nil, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := &http.Response{
				Header:        http.Header{"Content-Type": []string{"application/json"}},
				Body:          io.NopCloser(strings.NewReader(tc.payload)),
				ContentLength: tc.length, TransferEncoding: tc.transfer, Uncompressed: tc.uncompressed,
			}
			defer response.Body.Close()
			var dst struct{}
			if err := decodeBoundedOwnerReply(response, &dst, 8); (err == nil) != tc.want {
				t.Fatalf("frame acceptance=%t want=%t err=%v", err == nil, tc.want, err)
			}
		})
	}
}

func TestOwnerJSONRejectsActualCompressedHTTPAndRecovers(t *testing.T) {
	const body = `{"actorId":"wallet-one","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept-Encoding") != "identity" || r.Header.Get("Cache-Control") != "no-store" || r.Header.Get("Authorization") != token {
			t.Error("unexpected authority transport metadata")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if calls.Add(1) == 1 {
			w.Header().Set("Content-Encoding", "gzip")
			writer := gzip.NewWriter(w)
			_, _ = writer.Write([]byte(body))
			_ = writer.Close()
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	reader, err := newIdentityReader(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, status := reader.read(t.Context(), token); status != http.StatusServiceUnavailable {
		t.Fatalf("compressed owner accepted: %d", status)
	}
	if actor, status := reader.read(t.Context(), token); status != http.StatusOK || actor.ActorID != "wallet-one" {
		t.Fatalf("plain recovery failed: %d", status)
	}
}

func TestFinanceObservationRejectsSessionChangeDuringGrant(t *testing.T) {
	token := "Bearer " + base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	for _, tc := range []struct {
		name, successor string
		status, want    int
	}{
		{"revoked", "", 401, 401},
		{"different actor", `{"actorId":"operator-b","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200, 401},
		{"different role", `{"actorId":"operator-a","role":"customer","sessionExpiresAt":"2099-01-01T00:00:00Z"}`, 200, 403},
		{"expired", `{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2000-01-01T00:00:00Z"}`, 200, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var grants atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case sessionPath:
					if grants.Load() > 0 {
						w.WriteHeader(tc.status)
						_, _ = w.Write([]byte(tc.successor))
						return
					}
					_, _ = w.Write([]byte(`{"actorId":"operator-a","role":"operator","sessionExpiresAt":"2099-01-01T00:00:00Z"}`))
				case financePermissionPath:
					grants.Add(1)
					_, _ = w.Write([]byte(`{"actorId":"operator-a","permission":"finance"}`))
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			reader, err := newIdentityReader(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			actor, status := reader.finance(t.Context(), token)
			if status != tc.want || actor.ActorID != "" {
				t.Errorf("stale finance proof admitted: status=%d actor=%q", status, actor.ActorID)
			}
		})
	}
}
