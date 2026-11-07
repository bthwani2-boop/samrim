package identityhttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func TestClientBrowserSessionOriginAndCookieAdmission(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins:    map[string]bool{"http://localhost:18101": true, "http://localhost:18102": true},
		ClientWebOrigins:  map[string]bool{"http://localhost:18101": true},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	})
	for _, tc := range []struct {
		name, origin string
		want         int
	}{
		{"missing origin", "", http.StatusForbidden},
		{"partner applicant origin without cookie", "http://localhost:18102", http.StatusUnauthorized},
		{"untrusted origin", "http://localhost:9999", http.StatusForbidden},
		{"client missing cookie", "http://localhost:18101", http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/web/client/session", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d want=%d", rec.Code, tc.want)
			}
			if tc.origin == "http://localhost:18101" || tc.origin == "http://localhost:18102" {
				if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
					t.Fatal("approved web origin must receive credentialed CORS")
				}
			} else if rec.Header().Get("Access-Control-Allow-Credentials") != "" {
				t.Fatal("unapproved origin must not gain credentialed CORS")
			}
		})
	}
}

func TestClientBrowserCookiesSecureRoleScopedAndDistinctFromPartner(t *testing.T) {
	for _, dev := range []bool{true, false} {
		s := &Server{config: Config{ClientWebOrigins: map[string]bool{"http://localhost:18101": true}, Development: dev}}
		req := httptest.NewRequest(http.MethodPost, "/auth/client/login", nil)
		req.Header.Set("Origin", "http://localhost:18101")
		pair := domain.TokenPair{RefreshToken: "refresh.token.not.a.real.secret", Identity: domain.ActorIdentity{Role: "client", Surface: "app-client"}}
		rec := httptest.NewRecorder()
		s.setClientWebCookiesIfAuthorized(rec, req, pair, "test-client-instance")
		cookies := rec.Result().Cookies()
		if len(cookies) != 2 {
			t.Fatalf("development=%v cookies=%d want 2", dev, len(cookies))
		}
		for _, cookie := range cookies {
			if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" || strings.Contains(cookie.Name, "partner") {
				t.Fatalf("client cookie attributes or scope invalid: name=%s", cookie.Name)
			}
			if !dev && !strings.HasPrefix(cookie.Name, "__Host-") {
				t.Fatalf("non-development cookie lacks host prefix: %s", cookie.Name)
			}
		}
		rec = httptest.NewRecorder()
		pair.Identity = domain.ActorIdentity{Role: "partner", Surface: "app-partner"}
		s.setClientWebCookiesIfAuthorized(rec, req, pair, "test-client-instance")
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("partner identity must not receive client cookies")
		}
		rec = httptest.NewRecorder()
		pair.Identity = domain.ActorIdentity{Role: "client", Surface: "app-client"}
		req.Header.Set("Origin", "http://localhost:18102")
		s.setClientWebCookiesIfAuthorized(rec, req, pair, "test-client-instance")
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("partner origin must not receive client cookies")
		}
	}
}

func TestClientBrowserLogoutClearsCookiesWithoutBearer(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins:   map[string]bool{"http://localhost:18101": true},
		ClientWebOrigins: map[string]bool{"http://localhost:18101": true},
		Development:      true,
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/web/client/logout", nil)
	req.Header.Set("Origin", "http://localhost:18101")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d want 204", rec.Code)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("clear cookies=%d want 2", len(cookies))
	}
	for _, cookie := range cookies {
		if cookie.MaxAge >= 0 || !cookie.HttpOnly || !cookie.Secure {
			t.Fatal("client cookie not securely invalidated")
		}
	}
}

func TestClientBrowserJSONExcludesRefreshSecretButNativeRetainsItsPair(t *testing.T) {
	server := &Server{config: Config{Development: true, ClientWebOrigins: map[string]bool{"http://localhost:18101": true}}}
	pair := domain.TokenPair{
		AccessToken: "access.not.a.real.token", RefreshToken: "refresh.must.remain.secret",
		Identity: domain.ActorIdentity{Role: "client", Surface: "app-client"},
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/client/login", nil)
	req.Header.Set("Origin", "http://localhost:18101")
	rec := httptest.NewRecorder()
	server.writeClientAuthenticationResponse(rec, req, pair, "client-device-id", http.StatusOK)
	if strings.Contains(rec.Body.String(), pair.RefreshToken) || strings.Contains(rec.Body.String(), "refreshToken") {
		t.Fatal("client browser response exposed refresh secret")
	}
	if !strings.Contains(rec.Body.String(), pair.AccessToken) || len(rec.Result().Cookies()) != 2 {
		t.Fatal("client browser response lacks access proof or refresh cookie")
	}
	req.Header.Del("Origin")
	native := httptest.NewRecorder()
	server.writeClientAuthenticationResponse(native, req, pair, "client-device-id", http.StatusOK)
	if !strings.Contains(native.Body.String(), pair.RefreshToken) || len(native.Result().Cookies()) != 0 {
		t.Fatal("native login must retain token pair without web cookies")
	}
}

func TestClientBrowserAuthResponseFailClosedForWrongRoleOrOrigin(t *testing.T) {
	server := &Server{config: Config{Development: true, ClientWebOrigins: map[string]bool{"http://localhost:18101": true}}}
	for _, tc := range []struct{ name, origin, role, surface string }{
		{"approved client origin wrong role", "http://localhost:18101", "partner", "app-partner"},
		{"partner origin client proof", "http://localhost:18102", "client", "app-client"},
		{"missing origin wrong role", "", "partner", "app-partner"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/client/login", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			pair := domain.TokenPair{
				AccessToken: "access.not.a.real.token", RefreshToken: "never-expose-this-refresh-secret",
				Identity: domain.ActorIdentity{Role: tc.role, Surface: tc.surface},
			}
			rec := httptest.NewRecorder()
			server.writeClientAuthenticationResponse(rec, req, pair, "test-device-id", http.StatusOK)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status=%d want forbidden", rec.Code)
			}
			if strings.Contains(rec.Body.String(), pair.RefreshToken) || len(rec.Result().Cookies()) > 0 {
				t.Fatal("untrusted role/origin exposed refresh token or minted cookie")
			}
		})
	}
}

func TestApplicantBrowserRefreshCookiesAreSeparateFromClient(t *testing.T) {
	server := &Server{config: Config{
		ClientWebOrigins:  map[string]bool{"http://localhost:18101": true},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	}}
	pair := domain.TokenPair{
		AccessToken:  "test.access.token",
		RefreshToken: "test.refresh.secret.never.expose",
		Identity:     domain.ActorIdentity{Role: "client", Surface: "app-client"},
	}
	for _, tc := range []struct{ origin, cookieName, otherOrigin string }{
		{"http://localhost:18101", clientRefreshCookie, "http://localhost:18102"},
		{"http://localhost:18102", applicantRefreshCookie, "http://localhost:18101"},
	} {
		t.Run(tc.cookieName, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/auth/client/register", nil)
			req.Header.Set("Origin", tc.origin)
			rec := httptest.NewRecorder()
			server.writeClientAuthenticationResponse(rec, req, pair, "test-instance-1234", http.StatusCreated)
			if rec.Code != http.StatusCreated || strings.Contains(rec.Body.String(), pair.RefreshToken) || strings.Contains(rec.Body.String(), "refreshToken") {
				t.Fatalf("unacceptable client browser response: %d", rec.Code)
			}
			cookies := rec.Result().Cookies()
			if len(cookies) != 2 {
				t.Fatalf("got %d cookies, want 2", len(cookies))
			}
			found := false
			for _, cookie := range cookies {
				if cookie.Name == tc.cookieName {
					found = true
				}
				if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Name == partnerRefreshCookie || cookie.Name == partnerDeviceCookie {
					t.Fatal("client browser session cookie lacks security attributes")
				}
			}
			if !found {
				t.Fatalf("missing refresh cookie %q", tc.cookieName)
			}
			own := httptest.NewRequest(http.MethodPost, "/auth/web/client/session", nil)
			own.Header.Set("Origin", tc.origin)
			for _, cookie := range cookies {
				own.AddCookie(cookie)
			}
			refresh, device, ok := server.readClientWebCookies(own)
			if !ok || refresh != pair.RefreshToken || device != "test-instance-1234" {
				t.Fatal("own-origin session cookie cannot be read back")
			}
			own.Header.Set("Origin", tc.otherOrigin)
			if _, _, ok := server.readClientWebCookies(own); ok {
				t.Fatal("applicant web cookie leaked into ordinary client web session")
			}
		})
	}
}

func TestProspectivePartnerClientEntryRequiresExplicitTrustedPartnerOrigin(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins:    map[string]bool{"http://localhost:18101": true, "http://localhost:18102": true},
		ClientWebOrigins:  map[string]bool{"http://localhost:18101": true},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	})
	for _, path := range []string{"/auth/client/login", "/auth/client/register"} {
		for _, tc := range []struct {
			name, origin string
			want         int
		}{
			{"prospective partner", "http://localhost:18102", http.StatusBadRequest},
			{"untrusted", "http://localhost:9999", http.StatusForbidden},
			{"native without origin", "", http.StatusBadRequest},
		} {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				req := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{invalid"))
				req.Header.Set("Origin", tc.origin)
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, req)
				if rec.Code != tc.want {
					t.Fatalf("%s origin=%s status=%d want=%d", path, tc.origin, rec.Code, tc.want)
				}
			})
		}
	}
}
