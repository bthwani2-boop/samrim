package wallet

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	_ "github.com/lib/pq"
)

func TestSandboxProviderOriginIsLoopbackOnly(t *testing.T) {
	for _, origin := range []string{
		"http://localhost:3290", "http://0.0.0.0:3290", "http://192.168.0.1:3290",
		"https://127.0.0.1:3290", "http://user@127.0.0.1:3290",
		"http://127.0.0.1:0", "http://127.0.0.1:65536",
		"http://127.0.0.1:3290/path", "http://127.0.0.1:3290?token=1",
		"http://127.0.0.1:3290#state", "http://127.0.0.1:3290/",
	} {
		if validSandboxProviderOrigin(origin) {
			t.Errorf("accepted untrusted provider origin %q", origin)
		}
	}
	if !validSandboxProviderOrigin("http://127.0.0.1:3290") {
		t.Fatal("rejected valid isolated provider origin")
	}
}

func TestSandboxProviderEvidenceRejectsUnconfirmedOrMismatchedFunding(t *testing.T) {
	const reference, actor, amount = "cash-in-accepted-01", "wallet-one", int64(17)
	valid := `{"reference":"cash-in-accepted-01","actorId":"wallet-one","amountYer":"17","currency":"YER","status":"SUCCEEDED"}`
	for _, tc := range []struct {
		name, body, mediaType string
		code                  int
		allow                 bool
	}{
		{"confirmed", valid, "application/json", 200, true},
		{"pending", strings.Replace(valid, "SUCCEEDED", "PENDING", 1), "application/json", 200, false},
		{"failed", strings.Replace(valid, "SUCCEEDED", "FAILED", 1), "application/json", 200, false},
		{"unrecognized", strings.Replace(valid, "SUCCEEDED", "REFUNDED", 1), "application/json", 200, false},
		{"wrong-actor", strings.Replace(valid, "wallet-one", "wallet-two", 1), "application/json", 200, false},
		{"wrong-amount", strings.Replace(valid, "\"17\"", "\"18\"", 1), "application/json", 200, false},
		{"wrong-currency", strings.Replace(valid, "YER", "USD", 1), "application/json", 200, false},
		{"wrong-reference", strings.Replace(valid, reference, "cash-in-other-01", 1), "application/json", 200, false},
		{"float-amount", strings.Replace(valid, "\"17\"", "17", 1), "application/json", 200, false},
		{"extra-provider-field", strings.Replace(valid, "}", `,"overrideActor":"wallet-one"}`, 1), "application/json", 200, false},
		{"trailing-json", valid + `{}`, "application/json", 200, false},
		{"not-json", "pending", "text/plain", 200, false},
		{"oversized", valid + strings.Repeat(" ", 1100), "application/json", 200, false},
		{"redirect", valid, "application/json", 302, false},
		{"not-found", valid, "application/json", 404, false},
		{"provider-error", valid, "application/json", 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/sandbox/v1/funding/"+reference {
					t.Errorf("unexpected provider request: %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", tc.mediaType)
				if tc.code == http.StatusFound {
					w.Header().Set("Location", "http://example.invalid/steal")
				}
				w.WriteHeader(tc.code)
				_, _ = fmt.Fprint(w, tc.body)
			}))
			defer provider.Close()
			err := verifySandboxProviderEvidence(t.Context(), provider.URL, reference, actor, amount)
			if (err == nil) != tc.allow {
				t.Fatalf("provider allow=%t err=%v", tc.allow, err)
			}
		})
	}
}

func TestSandboxProviderNetworkAmbiguityFailsClosed(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer provider.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := verifySandboxProviderEvidence(ctx, provider.URL, "cash-in-accepted-01", "wallet-one", 17); err == nil {
		t.Fatal("a cancelled provider query was treated as success")
	}
	if err := verifySandboxProviderEvidence(context.Background(), "http://127.0.0.1:0", "cash-in-accepted-01", "wallet-one", 17); err == nil {
		t.Fatal("an unavailable provider was treated as success")
	}
}

func TestSandboxProviderFundingRejectsActorChangeBeforeDatabase(t *testing.T) {
	token := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	var reads atomic.Int32
	identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Error("unexpected session token")
		}
		actor := "wallet-one"
		if reads.Add(1) > 1 {
			actor = "wallet-two"
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"actorId": actor, "role": "customer", "sessionExpiresAt": "2099-01-01T00:00:00Z",
		})
	}))
	defer identity.Close()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"reference":"actor-change-01","actorId":"wallet-one","amountYer":"17","currency":"YER","status":"SUCCEEDED"}`)
	}))
	defer provider.Close()
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/bthwani_wlt_test?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	state, err := VerifySandboxProviderFunding(t.Context(), db, identity.URL, provider.URL, token, "actor-change-01", 17)
	if state != "" || err == nil || !strings.Contains(err.Error(), "provider actor changed") || reads.Load() != 2 {
		t.Fatalf("expected actor change denial before database access: state=%q err=%v reads=%d", state, err, reads.Load())
	}
}
