package identityhttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func TestPartnerBrowserSessionRequiresApprovedOriginAndCookie(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins: map[string]bool{
			"http://localhost:18102": true,
			"http://localhost:18101": true,
		},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	})
	for _, tc := range []struct {
		name, origin string
		want         int
	}{
		{"missing origin", "", http.StatusForbidden},
		{"other trusted app", "http://localhost:18101", http.StatusForbidden},
		{"untrusted origin", "http://localhost:9999", http.StatusForbidden},
		{"partner without cookie", "http://localhost:18102", http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/web/partner/session", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
			if tc.origin == "http://localhost:18102" {
				if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
					t.Fatal("approved Partner origin must receive credentialed CORS")
				}
			} else if rec.Header().Get("Access-Control-Allow-Credentials") != "" {
				t.Fatal("credentials must not be allowed for non-Partner origins")
			}
		})
	}
}

func TestPartnerBrowserCookiesStayHttpOnlyAndRoleScoped(t *testing.T) {
	for _, development := range []bool{true, false} {
		server := &Server{config: Config{
			Development:       development,
			PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		}}
		req := httptest.NewRequest(http.MethodPost, "/auth/managed/login", nil)
		req.Header.Set("Origin", "http://localhost:18102")
		pair := domain.TokenPair{
			RefreshToken: "refresh.token.not.a.real.secret",
			Identity:     domain.ActorIdentity{Role: "partner", Surface: "app-partner"},
		}
		rec := httptest.NewRecorder()
		server.setPartnerWebCookiesIfAuthorized(rec, req, pair, "test-client-instance")
		cookies := rec.Result().Cookies()
		if len(cookies) != 2 {
			t.Fatalf("development=%v: got %d cookies, want 2", development, len(cookies))
		}
		for _, cookie := range cookies {
			if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" {
				t.Fatalf("insecure cookie attributes: %#v", cookie)
			}
			if !cookie.Secure {
				t.Fatalf("development=%v: partner session cookie must always be Secure", development)
			}
			if !development && !strings.HasPrefix(cookie.Name, "__Host-") {
				t.Fatalf("production cookie must be host-only: %s", cookie.Name)
			}
		}

		rec = httptest.NewRecorder()
		pair.Identity.Role = "captain"
		pair.Identity.Surface = "app-captain"
		server.setPartnerWebCookiesIfAuthorized(rec, req, pair, "test-client-instance")
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("another role must not receive Partner cookies")
		}

		rec = httptest.NewRecorder()
		pair.Identity.Role = "partner"
		pair.Identity.Surface = "app-partner"
		req.Header.Set("Origin", "http://localhost:18101")
		server.setPartnerWebCookiesIfAuthorized(rec, req, pair, "test-client-instance")
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("another app origin must not receive Partner cookies")
		}
	}
}

func TestPartnerBrowserLogoutClearsCookiesWithoutBearer(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins:    map[string]bool{"http://localhost:18102": true},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/web/partner/logout", nil)
	req.Header.Set("Origin", "http://localhost:18102")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d", rec.Code)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("cleared cookies = %d", len(cookies))
	}
	for _, cookie := range cookies {
		if cookie.MaxAge >= 0 || !cookie.HttpOnly || !cookie.Secure {
			t.Fatalf("cookie not safely cleared: %#v", cookie)
		}
	}
}
