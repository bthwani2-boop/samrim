package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Legal release is a separate gate from authenticated owner submission.
// These negative cases must not reach Identity or the DSH database.
func TestIndependentSubmissionFailsClosedWithoutApprovedHostingTerms(t *testing.T) {
	t.Setenv("DSH_APPROVED_INDEPENDENT_HOSTING_TERMS_VERSION", "")
	server := &StoreAccessServer{}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"no legal version", `{"expectedVersion":1,"hostingTermsVersion":"made-up","termsAccepted":true}`, http.StatusConflict},
		{"unknown client authority", `{"expectedVersion":1,"hostingTermsVersion":"made-up","termsAccepted":true,"reviewState":"PASSED"}`, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/dsh/partner/stores/unpublished-store/independent-publication/submit", strings.NewReader(tc.body))
			req.Header.Set("Idempotency-Key", strings.Repeat("k", 16))
			req.Header.Set("X-Correlation-ID", "test-correlation")
			res := httptest.NewRecorder()
			mux.ServeHTTP(res, req)
			if res.Code != tc.want {
				t.Fatalf("unexpected response: %d %s", res.Code, res.Body.String())
			}
			if res.Header().Get("Cache-Control") != "no-store" || res.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
				t.Fatalf("private rejection must be uncached and noindex: %+v", res.Header())
			}
			for _, secret := range []string{"ownerPhone", "partnerActorId", "privateStore"} {
				if strings.Contains(res.Body.String(), secret) {
					t.Fatal("private metadata leaked")
				}
			}
		})
	}
}
func TestIndependentSubmissionDoesNotAcceptSpoofedOrOutdatedTerms(t *testing.T) {
	t.Setenv("DSH_APPROVED_INDEPENDENT_HOSTING_TERMS_VERSION", "approved-v2")
	server := &StoreAccessServer{}
	mux := http.NewServeMux()
	server.Register(mux)
	for _, body := range []string{
		`{"expectedVersion":1,"hostingTermsVersion":"approved-v1","termsAccepted":true}`,
		`{"expectedVersion":1,"hostingTermsVersion":"approved-v2","termsAccepted":false}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/dsh/partner/stores/unpublished-store/independent-publication/submit", strings.NewReader(body))
		req.Header.Set("Idempotency-Key", strings.Repeat("k", 16))
		req.Header.Set("X-Correlation-ID", "test-correlation")
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != http.StatusConflict {
			t.Fatalf("bad terms must reject before owner mutation: %d %s", res.Code, res.Body.String())
		}
	}
}
