package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestStoreTrashEndpointsGuardAuthenticationAndInvalidInput(t *testing.T) {
	token, err := auth.NewServiceToken("ssssssssssssssssssssssss")
	if err != nil {
		t.Fatal(err)
	}
	server := &StorePublicationServer{auth: token}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /dsh/operator/stores/trash", server.listStoreTrash)
	mux.HandleFunc("POST /dsh/operator/stores/{storeId}/trash", server.trashStore)
	mux.HandleFunc("POST /dsh/operator/stores/{storeId}/restore", server.restoreStore)
	tests := []struct {
		name, method, path, body, authority string
		versioned                           bool
		want                                int
	}{
		{"list without service token", "GET", "/dsh/operator/stores/trash", "", "", false, 401},
		{"archive without service token", "POST", "/dsh/operator/stores/store-test/trash", "", "", false, 401},
		{"restore without service token", "POST", "/dsh/operator/stores/store-test/restore", "", "", false, 401},
		{"list without operator actor", "GET", "/dsh/operator/stores/trash", "", "service-no-actor", false, 400},
		{"list with excessive limit", "GET", "/dsh/operator/stores/trash?limit=101", "", "service", false, 400},
		{"archive invalid body", "POST", "/dsh/operator/stores/store-test/trash", "{", "service", true, 400},
		{"restore unexpected reason", "POST", "/dsh/operator/stores/store-test/restore", `{"reason":"invalid"}`, "service", true, 400},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.authority == "service" || tc.authority == "service-no-actor" {
				req.Header.Set("Authorization", "Bearer ssssssssssssssssssssssss")
			}
			if tc.authority == "service" {
				req.Header.Set("X-Acting-Actor-ID", "operator-test")
			}
			req.Header.Set("X-Correlation-ID", "correlation-test")
			req.Header.Set("Idempotency-Key", "store-trash-idempotency-test")
			if tc.versioned {
				req.Header.Set("X-Expected-Version", "1")
			}
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got HTTP %d want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
