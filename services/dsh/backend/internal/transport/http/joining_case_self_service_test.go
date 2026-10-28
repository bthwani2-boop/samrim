package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSelfServiceApplicationRejectsUnauthenticatedAndSpoofedActor(t *testing.T) {
	server := &JoiningCaseServer{}
	router := http.NewServeMux()
	server.Register(router)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method+" without bearer", func(t *testing.T) {
			r := httptest.NewRequest(method, "/dsh/partner-applications/self", nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d", w.Code)
			}
		})
	}
	request := httptest.NewRequest(http.MethodPost, "/dsh/partner-applications/self", strings.NewReader("{}"))
	request.Header.Set("Authorization", "Bearer unverified")
	request.Header.Set("X-Acting-Actor-ID", "fake-operator")
	request.Header.Set("Idempotency-Key", "idem-example-123")
	request.Header.Set("X-Correlation-ID", "corr-example-123")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
		t.Fatalf("spoofed actor was not rejected: %d %s", response.Code, response.Body.String())
	}
}
