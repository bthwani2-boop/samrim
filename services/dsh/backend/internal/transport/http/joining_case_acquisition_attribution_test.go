package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestAttributionRouteRefusesUnauthenticatedCall(t *testing.T) {
	token, err := auth.NewServiceToken(strings.Repeat("t", 24))
	if err != nil {
		t.Fatal(err)
	}
	server := &JoiningCaseServer{auth: token}
	router := http.NewServeMux()
	server.Register(router)
	request := httptest.NewRequest(http.MethodPost, "/dsh/joining-cases/case-test/acquisition-attribution", strings.NewReader(`{"fieldActorId":"field-test","reason":"visit evidence"}`))
	request.Header.Set("X-Acting-Actor-ID", "fake-operator")
	request.Header.Set("X-Expected-Version", "1")
	request.Header.Set("X-Correlation-ID", "corr-test-123")
	request.Header.Set("Idempotency-Key", "idem-test-123")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
}
