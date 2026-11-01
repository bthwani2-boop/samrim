package transporthttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCatalogInventorySummaryRequiresAuthorizedActor(t *testing.T) {
	token, err := auth.NewServiceToken("test-only-long-boundary-token-12345")
	if err != nil {
		t.Fatal(err)
	}
	service := &CatalogServer{auth: token}
	cases := []struct {
		name    string
		path    string
		handler http.HandlerFunc
		bearer  string
		actor   string
		status  int
	}{
		{name: "partner no session", path: "/dsh/stores/store-a/inventory-summary", handler: service.readPartnerStoreInventorySummary, status: http.StatusUnauthorized},
		{name: "operator no service credential", path: "/dsh/operator/stores/store-a/inventory-summary", handler: service.readOperatorStoreInventorySummary, status: http.StatusUnauthorized},
		{name: "operator cannot omit actor attribution", path: "/dsh/operator/stores/store-a/inventory-summary", handler: service.readOperatorStoreInventorySummary, bearer: "test-only-long-boundary-token-12345", status: http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tc.path, nil)
			request.SetPathValue("storeId", "store-a")
			if tc.bearer != "" {
				request.Header.Set("Authorization", "Bearer "+tc.bearer)
			}
			if tc.actor != "" {
				request.Header.Set("X-Acting-Actor-ID", tc.actor)
			}
			response := httptest.NewRecorder()
			tc.handler(response, request)
			if response.Code != tc.status {
				t.Fatalf("status=%d expected %d body=%s", response.Code, tc.status, response.Body.String())
			}
			if !strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
				t.Fatal("error should be JSON")
			}
			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Error.Code == "" {
				t.Fatalf("missing structured error: %s", response.Body.String())
			}
		})
	}
}

func TestInventorySummaryResponseProjectsOnlyStoreScopedCounts(t *testing.T) {
	input := postgres.CatalogInventorySummary{StoreID: "store-a", TotalOffers: 130, PublishedOffers: 120, AvailableOffers: 115, UnavailableOffers: 5, StockoutOffers: 2}
	result := inventorySummaryResponse(input)
	if result.Summary.StoreID != "store-a" || result.Summary.TotalOffers != 130 || result.Summary.PublishedOffers != 120 ||
		result.Summary.AvailableOffers != 115 || result.Summary.UnavailableOffers != 5 || result.Summary.StockoutOffers != 2 {
		t.Fatalf("wrong canonical projection: %#v", result)
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 1 {
		t.Fatalf("inventory response leaks unsupported fields: %s", data)
	}
}
