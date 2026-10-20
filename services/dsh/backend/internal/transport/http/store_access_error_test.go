package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeaccess"
)

func TestStoreAccessReportsDisabledActorSecurity(t *testing.T) {
	response := httptest.NewRecorder()
	writeStoreAccessError(response, storeaccess.ErrActorSecurityDisabled)

	if response.Code != http.StatusConflict {
		t.Fatalf("disabled Actor status = %d, want %d", response.Code, http.StatusConflict)
	}
	if !strings.Contains(response.Body.String(), `"code":"ACTOR_SECURITY_DISABLED"`) {
		t.Fatalf("disabled Actor invitation error = %q, want ACTOR_SECURITY_DISABLED", response.Body.String())
	}
}

func TestStoreAccessInvitationRoutesRequireActorAcceptanceAndPartnerActivation(t *testing.T) {
	mux := http.NewServeMux()
	(&StoreAccessServer{}).Register(mux)
	routes := []struct {
		method  string
		path    string
		pattern string
	}{
		{http.MethodGet, "/dsh/actor/store-access-invitations", "GET /dsh/actor/store-access-invitations"},
		{http.MethodPost, "/dsh/actor/store-access-invitations/grant-1/decision", "POST /dsh/actor/store-access-invitations/{grantId}/decision"},
		{http.MethodPost, "/dsh/partner/store-access-invitations/grant-1/activate", "POST /dsh/partner/store-access-invitations/{grantId}/activate"},
	}
	for _, route := range routes {
		if _, pattern := mux.Handler(httptest.NewRequest(route.method, route.path, nil)); pattern != route.pattern {
			t.Fatalf("route %s %s resolved to %q, want %q", route.method, route.path, pattern, route.pattern)
		}
	}
	if _, pattern := mux.Handler(httptest.NewRequest(http.MethodGet, "/dsh/partner/access-invitations", nil)); pattern != "" {
		t.Fatalf("legacy Partner-only invitation path remains registered as %q", pattern)
	}
}
