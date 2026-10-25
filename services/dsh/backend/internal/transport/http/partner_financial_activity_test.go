package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPartnerActivityRejectsForeignStoreBeforeWLT(t *testing.T) {
	server := &PartnerFinanceServer{}
	available := []postgres.PartnerFinanceStore{{ID: "store-allowed", Name: "متجر مصرح", PartnerActorID: "partner-allowed"}}
	for _, q := range []string{"storeId=store-foreign", "storeId=store-allowed&storeId=store-foreign"} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/partners/me/financial-activity?"+q, nil)
		response := httptest.NewRecorder()
		server.listScopedActivity(response, request, available)
		if response.Code != http.StatusForbidden {
			t.Fatalf("foreign store query %q must fail closed: %d", q, response.Code)
		}
	}
}
