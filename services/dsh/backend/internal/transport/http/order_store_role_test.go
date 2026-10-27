package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequirePartnerStoreOrderReadRole(t *testing.T) {
	for _, tc := range []struct {
		name string
		role string
		want bool
	}{
		{name: "partner", role: "partner", want: true},
		{name: "client", role: "client"},
		{name: "missing role"},
		{name: "other role", role: "operator"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			if got := requirePartnerStoreOrderReadRole(response, tc.role); got != tc.want {
				t.Fatalf("role allowed: got %t, want %t", got, tc.want)
			}
			if tc.want {
				if response.Code != http.StatusOK {
					t.Fatalf("partner role wrote response status %d", response.Code)
				}
				return
			}
			if response.Code != http.StatusForbidden {
				t.Fatalf("denied role status: got %d, want %d", response.Code, http.StatusForbidden)
			}
			if !strings.Contains(response.Body.String(), "FORBIDDEN") {
				t.Fatalf("denied role response lacks FORBIDDEN code: %s", response.Body.String())
			}
		})
	}
}
