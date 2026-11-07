package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

func TestIndependentPreviewRouteRejectsUnauthenticatedAndSpoofedActor(t *testing.T) {
	authToken, err := auth.NewServiceToken("independent-preview-service-token-for-tests")
	if err != nil {
		t.Fatal(err)
	}
	server := &StoreAccessServer{operatorAuth: authToken, service: &storeaccess.Service{}}
	router := http.NewServeMux()
	server.Register(router)
	tests := []struct {
		name, path, header string
		want               int
	}{
		{"missing Partner session", "/dsh/partner/stores/independent/independent-preview", "", http.StatusForbidden},
		{"spoofed owner ID", "/dsh/partner/stores/independent/independent-preview", "X-Actor-ID", http.StatusBadRequest},
		{"spoofed operator ID", "/dsh/partner/stores/independent/independent-preview", "X-Acting-Actor-ID", http.StatusBadRequest},
		{"out-of-bounds page", "/dsh/partner/stores/independent/independent-preview?limit=500", "", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.header != "" {
				request.Header.Set(tt.header, "foreign-actor")
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != tt.want {
				t.Fatalf("unexpected status %d (want %d): %s", recorder.Code, tt.want, recorder.Body.String())
			}
			if recorder.Header().Get("Access-Control-Allow-Origin") == "*" {
				t.Fatal("private Store preview cannot be publicly readable through wildcard CORS")
			}
		})
	}
}
