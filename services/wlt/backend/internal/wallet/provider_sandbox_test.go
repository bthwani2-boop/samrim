package wallet

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
