package session

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCaptainIdentityHTTPDeniesIncompleteOwnerAndMalformedCredentials(t *testing.T) {
	h := NewCaptainHandler(NewCaptainAdmission(nil, nil))
	cases := []struct {
		method, path, bearer string
		status               int
	}{
		{http.MethodGet, "/v1/actors/me/captain-role", "", http.StatusMethodNotAllowed},
		{http.MethodPost, "/v1/actors/me/captain-role", "", http.StatusUnauthorized},
		{http.MethodPost, "/v1/actors/me/captain-session", "Bearer invalid", http.StatusUnauthorized},
		{http.MethodPost, "/v1/actors/me/captain-role", "Bearer " + strings.Repeat("a", 43), http.StatusUnauthorized},
		{http.MethodPost, "/v1/actors/me/captain-role", "Bearer " + strings.Repeat("A", 43), http.StatusServiceUnavailable},
		{http.MethodPost, "/v1/actors/other/captain-role", "", http.StatusNotFound},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.bearer != "" {
			req.Header.Set("Authorization", tc.bearer)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s got %d want %d", tc.method, tc.path, w.Code, tc.status)
		}
	}
}
