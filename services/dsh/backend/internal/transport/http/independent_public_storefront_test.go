package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndependentPublicStorefrontRequiresReleaseAndLegalApproval(t *testing.T) {
	for _, tc := range []struct {
		name    string
		release bool
		terms   string
	}{
		{"release disabled", false, "approved-v1"},
		{"terms unapproved", true, ""},
		{"terms blank", true, "  "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mux := http.NewServeMux()
			NewIndependentPublicStorefront(nil, tc.release, tc.terms, "example.test").Register(mux)
			for _, path := range []string{
				"/dsh/public/independent-stores/private-store?serviceCityId=sanaa",
				"/dsh/public/independent-stores/private-store/catalog?serviceCityId=sanaa",
				"/dsh/public/independent-stores/private-store/banners?serviceCityId=sanaa",
				"/dsh/public/independent-stores/private-store?serviceCityId=sanaa&relationModel=INDEPENDENT_STORE",
			} {
				response := httptest.NewRecorder()
				mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
				if response.Code != http.StatusNotFound {
					t.Fatalf("%s returned %d, want 404", path, response.Code)
				}
				if got := response.Header().Get("Cache-Control"); got != "no-store" {
					t.Fatalf("unexpected caching for %s: %q", path, got)
				}
				if got := response.Header().Get("X-Robots-Tag"); got != "noindex, nofollow" {
					t.Fatalf("unexpected indexing for %s: %q", path, got)
				}
				if body := response.Body.String(); len(body) > 0 && (strings.Contains(body, "private-phone") || strings.Contains(body, "private-store-owner")) {
					t.Fatal("private information was exposed")
				}
			}
		})
	}
}

func TestIndependentPublicStorefrontValidatesScopeAndPaginationBeforeReadingDB(t *testing.T) {
	mux := http.NewServeMux()
	NewIndependentPublicStorefront(nil, true, "approved-v1", "example.com").Register(mux)
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/dsh/public/independent-stores/store-1", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&limit=0", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/banners?serviceCityId=sanaa&serviceCityId=aden", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/banners?serviceCityId=sanaa&relationModel=BTHWANI_PARTNER", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/banners?serviceCityId=sanaa", http.StatusNotFound},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&limit=51", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&limit=abc", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&serviceCityId=aden", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&categoryId=category-a", http.StatusNotFound},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&productId=product-a", http.StatusNotFound},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&q=coffee", http.StatusNotFound},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&categoryId=" + strings.Repeat("x", 129), http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&productId=" + strings.Repeat("x", 129), http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&q=" + strings.Repeat("x", 161), http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1/catalog?serviceCityId=sanaa&%ZZ=ignored", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1?serviceCityId=sanaa&%ZZ=ignored", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1?serviceCityId=sanaa&q=private", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1?serviceCityId=sanaa&relationModel=BTHWANI_PARTNER", http.StatusBadRequest},
		{"/dsh/public/independent-stores/store-1?serviceCityId=sanaa", http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if recorder.Code != tc.want {
			t.Errorf("%q returned %d want %d", tc.path, recorder.Code, tc.want)
		}
	}
}

func TestIndependentPublicMediaMustUsePublicHTTPS(t *testing.T) {
	for _, tc := range []struct {
		uri  string
		safe bool
	}{
		{"https://cdn.bthwani.com/store/a.jpg", true},
		{"", false},
		{"http://cdn.bthwani.com/store/a.jpg", false},
		{"https://localhost/secret.jpg", false},
		{"https://127.0.0.1/secret.jpg", false},
		{"https://10.1.2.3/secret.jpg", false},
		{"https://store.local/secret.jpg", false},
		{"https://store.local./secret.jpg", false},
		{"https://localhost./secret.jpg", false},
		{"https://printer/secret.jpg", false},
		{"https://printer.localhost/secret.jpg", false},
		{"https://127.1/secret.jpg", false},
		{"https://2130706433/secret.jpg", false},
		{"https://cdn.bthwani.com./store/a.jpg", false},
		{"https://private:password@cdn.bthwani.com/a.jpg", false},
		{"file:///etc/passwd", false},
		{" https://cdn.bthwani.com/store/a.jpg ", false},
	} {
		if got := safeIndependentPublicMediaURI(tc.uri); got != tc.safe {
			t.Errorf("safeIndependentPublicMediaURI(%q)=%v, want %v", tc.uri, got, tc.safe)
		}
	}
}

func TestIndependentPublicStorefrontRejectsUntrustedHostBeforeDatabaseRead(t *testing.T) {
	server := NewIndependentPublicStorefront(nil, true, "approved-v1", "shop.example, www.shop.example")
	for _, tc := range []struct {
		host    string
		allowed bool
	}{
		{"shop.example", true},
		{"WWW.SHOP.EXAMPLE", true},
		{"shop.example.attacker.test", false},
		{"attacker.test", false},
		{"shop.example:443", false},
		{"localhost", false},
	} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/public/independent-stores/store-a?serviceCityId=sanaa", nil)
		request.Host = tc.host
		request.SetPathValue("storeId", "store-a")
		request.Header.Set("X-Forwarded-Host", "shop.example")
		recorder := httptest.NewRecorder()
		storeID, cityID, permitted := server.publicScope(recorder, request)
		if permitted != tc.allowed {
			t.Errorf("host=%q permitted=%v, want=%v", tc.host, permitted, tc.allowed)
		}
		if tc.allowed && (storeID != "store-a" || cityID != "sanaa") {
			t.Errorf("allowed host=%q lost canonical Store/City scope", tc.host)
		}
		if !tc.allowed && recorder.Code != http.StatusNotFound {
			t.Errorf("untrusted host=%q returned %d instead of 404", tc.host, recorder.Code)
		}
	}
	// Explicit release with no legal host is still a private endpoint.
	request := httptest.NewRequest(http.MethodGet, "/dsh/public/independent-stores/store-a?serviceCityId=sanaa", nil)
	request.SetPathValue("storeId", "store-a")
	response := httptest.NewRecorder()
	_, _, permitted := NewIndependentPublicStorefront(nil, true, "approved-v1", "").publicScope(response, request)
	if permitted || response.Code != http.StatusNotFound {
		t.Fatalf("an unconfigured public host must fail closed, code=%d", response.Code)
	}
}
