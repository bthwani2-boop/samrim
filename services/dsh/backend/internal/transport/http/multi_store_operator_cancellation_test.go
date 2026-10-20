package transporthttp

import (
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
)

func TestMultiStoreCommercialCancellationRequiresOperations(t *testing.T) {
    mux := http.NewServeMux()
    (&MultiStoreCheckoutServer{}).Register(mux)
    for _, scenario := range []struct {
        name string
        token string
        expected int
        forged bool
    }{
        {"anonymous", "", http.StatusUnauthorized, false},
        {"authenticated client", "legitimate-client-session", http.StatusForbidden, false},
        {"forged operations actor", "legitimate-client-session", http.StatusForbidden, true},
    } {
        t.Run(scenario.name, func(t *testing.T) {
            r := httptest.NewRequest(http.MethodPost, "/dsh/multi-store-checkouts/parent-1/cancel",
                strings.NewReader(`{"expectedVersion":1}`))
            if scenario.token != "" {
                r.Header.Set("Authorization", "Bearer "+scenario.token)
            }
            if scenario.forged {
                r.Header.Set("X-Acting-Actor-ID", "root-owner")
                r.Header.Set("X-Actor-ID", "another-client")
            }
            w := httptest.NewRecorder()
            mux.ServeHTTP(w, r)
            if w.Code != scenario.expected {
                t.Fatalf("legacy multi-store cancellation returned %d, expected %d: %s",
                    w.Code, scenario.expected, w.Body.String())
            }
            if scenario.expected == http.StatusForbidden &&
                !strings.Contains(w.Body.String(), "OPERATIONS_REVIEW_REQUIRED") {
                t.Fatalf("commercial cancellation did not require Operations review: %s", w.Body.String())
            }
        })
    }
}
