package runtime

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBrowserCORSAllowedOrigin(t *testing.T) {
	h := browserCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), "http://localhost:18101, http://localhost:18102")

	for _, origin := range []string{"http://localhost:18101", "http://localhost:18102"} {
		req := httptest.NewRequest(http.MethodGet, "/dsh/public/service-cities", nil)
		req.Header.Set("Origin", origin)
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Header().Get("Access-Control-Allow-Origin") != origin {
			t.Fatalf("origin %s: got status %d and CORS origin %q", origin, res.Code, res.Header().Get("Access-Control-Allow-Origin"))
		}
	}
}

func TestBrowserCORSPreflight(t *testing.T) {
	h := browserCORS(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("preflight must not reach application route")
	}), "http://localhost:18101")
	req := httptest.NewRequest(http.MethodOptions, "/dsh/orders", nil)
	req.Header.Set("Origin", "http://localhost:18101")
	req.Header.Set("Access-Control-Request-Method", "PATCH")
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type,x-expected-version")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent || !strings.Contains(res.Header().Get("Access-Control-Allow-Methods"), "PATCH") || !strings.Contains(res.Header().Get("Access-Control-Allow-Headers"), "X-Expected-Version") {
		t.Fatalf("invalid preflight response: status=%d headers=%v", res.Code, res.Header())
	}
}

func TestBrowserCORSUnlistedOriginRejectedAndNativeUnaffected(t *testing.T) {
	h := browserCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}), "http://localhost:18101,*")
	denied := httptest.NewRequest(http.MethodGet, "/", nil)
	denied.Header.Set("Origin", "http://untrusted.example")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, denied)
	if res.Code != http.StatusForbidden || res.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unexpected access for unlisted origin: %d, %v", res.Code, res.Header())
	}
	native := httptest.NewRequest(http.MethodGet, "/", nil)
	res = httptest.NewRecorder()
	h.ServeHTTP(res, native)
	if res.Code != http.StatusAccepted {
		t.Fatalf("native client without Origin must remain unaffected: %d", res.Code)
	}
}
