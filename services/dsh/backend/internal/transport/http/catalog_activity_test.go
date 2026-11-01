package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPartnerActivityRejectsMissingSessionAndForgedActor(t *testing.T) {
	s := &CatalogServer{}
	cases := []struct {
		name   string
		bearer bool
		actor  bool
		want   int
	}{
		{"anonymous", false, false, http.StatusUnauthorized},
		{"forged-actor", true, true, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/dsh/stores/store-two/catalog-activity", nil)
			if tc.bearer {
				req.Header.Set("Authorization", "Bearer valid-shape-token")
			}
			if tc.actor {
				req.Header.Set("X-Acting-Actor-ID", "forged-partner")
			}
			rec := httptest.NewRecorder()
			s.listPartnerCatalogActivity(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("expected %d, got %d: %s", tc.want, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestPartnerActivityRejectsStoreAndKindScopeOverrides(t *testing.T) {
	s := &CatalogServer{}
	for _, raw := range []string{"?storeId=another-store", "?kind=product", "?storeId=another-store&kind=offer"} {
		t.Run(raw, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/dsh/stores/store-one/catalog-activity"+raw, nil)
			req.Header.Set("Authorization", "Bearer valid-shape-token")
			rec := httptest.NewRecorder()
			s.listPartnerCatalogActivity(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("scope override accepted (%s): status=%d body=%s", raw, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestCatalogActivityFilterBounds(t *testing.T) {
	for _, raw := range []string{"?limit=0", "?limit=99", "?action=delete", "?kind=admin", "?cursor=" + strings.Repeat("a", 2049), "?q=" + strings.Repeat("x", 121)} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/dsh/operator/catalog-activity"+raw, nil)
		if _, ok := catalogActivityFilters(rec, req); ok || rec.Code != http.StatusBadRequest {
			t.Errorf("unsafe filter accepted: %s (%d)", raw, rec.Code)
		}
	}
}
