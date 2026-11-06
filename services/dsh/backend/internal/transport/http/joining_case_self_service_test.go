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

func TestSelfServiceCorrectionRequiresVerifiedBearerAndRejectsActorSpoofing(t *testing.T) {
	server := &JoiningCaseServer{}
	router := http.NewServeMux()
	server.Register(router)
	const path = "/dsh/partner-applications/self/correct-and-resubmit"

	for _, tc := range []struct {
		name       string
		token      string
		actor      string
		version    string
		wantStatus int
	}{
		{name: "missing bearer", wantStatus: http.StatusUnauthorized},
		{name: "actor override", token: "unverified", actor: "another-actor", version: "1", wantStatus: http.StatusBadRequest},
		{name: "missing version", token: "unverified", wantStatus: http.StatusBadRequest},
		{name: "malformed JSON rejected before identity", token: "unverified", version: "1", wantStatus: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
			if tc.token != "" {
				request.Header.Set("Authorization", "Bearer "+tc.token)
			}
			if tc.actor != "" {
				request.Header.Set("X-Actor-ID", tc.actor)
			}
			request.Header.Set("Idempotency-Key", "self-correction-test-123")
			request.Header.Set("X-Correlation-ID", "self-correction-correlation-123")
			if tc.version != "" {
				request.Header.Set("X-Expected-Version", tc.version)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, tc.wantStatus, response.Body.String())
			}
		})
	}
}
