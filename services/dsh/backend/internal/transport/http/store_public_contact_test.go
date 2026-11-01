package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

func TestStoreContactRoutesRejectUnauthenticatedAndLegacyActorHeaders(t *testing.T) {
	serviceToken := "store-public-contact-test-service-authentication-key"
	operatorAuth, err := auth.NewServiceToken(serviceToken)
	if err != nil {
		t.Fatal(err)
	}
	server := &StoreAccessServer{operatorAuth: operatorAuth, service: &storeaccess.Service{}}
	mux := http.NewServeMux()
	server.Register(mux)

	cases := []struct {
		name, method, path string
		status             int
		auth, header       string
	}{
		{"partner without login", "GET", "/dsh/partner/stores/store-a/contact", http.StatusForbidden, "", ""},
		{"write without mutation headers", "PUT", "/dsh/partner/stores/store-a/contact", http.StatusBadRequest, "", ""},
		{"operator without service auth", "GET", "/dsh/operator/stores/store-a/contact", http.StatusUnauthorized, "", ""},
		{"operator with legacy actor header", "GET", "/dsh/operator/stores/store-a/contact", http.StatusBadRequest, "Bearer " + serviceToken, "X-Actor-ID"},
		{"operator without actor header", "GET", "/dsh/operator/stores/store-a/contact", http.StatusBadRequest, "Bearer " + serviceToken, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.auth != "" {
				req.Header.Set("Authorization", tc.auth)
			}
			if tc.header != "" {
				req.Header.Set(tc.header, "forged")
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tc.status, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "phoneE164") || strings.Contains(rec.Body.String(), "email") {
				t.Fatalf("unauthorized Store data returned: %s", rec.Body.String())
			}
		})
	}
}
