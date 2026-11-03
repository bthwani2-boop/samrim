package identityhttp

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

const clientRefreshCookie = "bt_client_web_refresh"
const clientDeviceCookie = "bt_client_web_device"

func (s *Server) clientCookieName(base string) string {
	if s.config.Development {
		return base
	}
	return "__Host-" + base
}

func (s *Server) clientWebOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	return origin != "" && s.config.ClientWebOrigins[origin]
}

func (s *Server) rejectUnauthorizedClientBrowserOrigin(w http.ResponseWriter, r *http.Request) bool {
	if strings.TrimSpace(r.Header.Get("Origin")) != "" && !s.clientWebOriginAllowed(r) {
		writeDomainError(w, domain.ErrForbidden)
		return true
	}
	return false
}

func (s *Server) clientWebCookies(w http.ResponseWriter, refreshToken, device string, maxAge int) {
	for _, item := range []struct{ name, value string }{
		{clientRefreshCookie, refreshToken}, {clientDeviceCookie, device},
	} {
		http.SetCookie(w, &http.Cookie{
			Name: s.clientCookieName(item.name), Value: item.value, Path: "/",
			HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: maxAge,
		})
	}
}

func (s *Server) setClientWebCookiesIfAuthorized(w http.ResponseWriter, r *http.Request, pair domain.TokenPair, device string) {
	if !s.clientWebOriginAllowed(r) || pair.Identity.Role != "client" || pair.Identity.Surface != "app-client" {
		return
	}
	// The cookie expires no later than the canonical 30-day refresh window.
	s.clientWebCookies(w, pair.RefreshToken, device, 30*24*60*60)
}

func (s *Server) readClientWebCookies(r *http.Request) (string, string, bool) {
	refresh, errRefresh := r.Cookie(s.clientCookieName(clientRefreshCookie))
	device, errDevice := r.Cookie(s.clientCookieName(clientDeviceCookie))
	if errRefresh != nil || errDevice != nil || len(refresh.Value) < 20 || len(device.Value) < 8 {
		return "", "", false
	}
	return refresh.Value, device.Value, true
}

func clientWebRefreshRequest(refresh, device string) domain.RefreshRequest {
	digest := sha256.Sum256([]byte("client-web-refresh-v1\x00" + refresh + "\x00" + device))
	return domain.RefreshRequest{RefreshToken: refresh, ClientInstanceId: device, RefreshRequestId: hex.EncodeToString(digest[:])}
}

func (s *Server) webClientSession(w http.ResponseWriter, r *http.Request) {
	if !s.clientWebOriginAllowed(r) {
		writeDomainError(w, domain.ErrForbidden)
		return
	}
	if r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		writeDomainError(w, domain.ErrInvalidInput)
		return
	}
	refresh, device, ok := s.readClientWebCookies(r)
	if !ok {
		writeDomainError(w, domain.ErrUnauthenticated)
		return
	}
	// Deterministic retry ID preserves refresh safety after a lost response.
	pair, err := s.sessions.Refresh(r.Context(), clientWebRefreshRequest(refresh, device))
	if err != nil {
		if errors.Is(err, domain.ErrInvalidRefresh) || errors.Is(err, domain.ErrUnauthenticated) {
			s.clientWebCookies(w, "", "", -1)
		}
		writeDomainError(w, err)
		return
	}
	if pair.Identity.Role != "client" || pair.Identity.Surface != "app-client" {
		s.clientWebCookies(w, "", "", -1)
		writeDomainError(w, domain.ErrForbidden)
		return
	}
	s.writeClientAuthenticationResponse(w, r, pair, device, http.StatusOK)
}

func (s *Server) webClientLogout(w http.ResponseWriter, r *http.Request) {
	if !s.clientWebOriginAllowed(r) {
		writeDomainError(w, domain.ErrForbidden)
		return
	}
	if r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		writeDomainError(w, domain.ErrInvalidInput)
		return
	}
	refresh, device, hasCookie := s.readClientWebCookies(r)
	if token, ok := bearerToken(r); ok {
		identity, err := s.sessions.ResolveAccessToken(r.Context(), token)
		if err == nil {
			if identity.Role != "client" || identity.Surface != "app-client" {
				writeDomainError(w, domain.ErrForbidden)
				return
			}
			if err := s.sessions.Logout(r.Context(), token); err != nil && !errors.Is(err, domain.ErrUnauthenticated) {
				writeDomainError(w, err)
				return
			}
		} else if !errors.Is(err, domain.ErrUnauthenticated) {
			writeDomainError(w, err)
			return
		}
	}
	// A now-expired access token must not leave its refresh session behind.
	if hasCookie {
		pair, err := s.sessions.Refresh(r.Context(), clientWebRefreshRequest(refresh, device))
		if err == nil {
			if pair.Identity.Role != "client" || pair.Identity.Surface != "app-client" {
				writeDomainError(w, domain.ErrForbidden)
				return
			}
			if err := s.sessions.Logout(r.Context(), pair.AccessToken); err != nil && !errors.Is(err, domain.ErrUnauthenticated) {
				// Refresh already rotated the credential. Keep the new cookie
				// when logout fails so the browser can retry revocation.
				s.clientWebCookies(w, pair.RefreshToken, device, 30*24*60*60)
				writeDomainError(w, err)
				return
			}
		} else if !errors.Is(err, domain.ErrInvalidRefresh) && !errors.Is(err, domain.ErrUnauthenticated) && !errors.Is(err, domain.ErrRefreshStale) {
			writeDomainError(w, err)
			return
		}
	}
	// Expire cookies only after both bearer and cookie sessions are revoked.
	s.clientWebCookies(w, "", "", -1)
	w.WriteHeader(http.StatusNoContent)
}

type clientBrowserAccessPair struct {
	AccessToken  string               `json:"accessToken"`
	AccessExpiry time.Time            `json:"accessExpiresAt"`
	Identity     domain.ActorIdentity `json:"identity"`
}

// Browser JavaScript receives only the short-lived access token. The refresh
// token stays in an HttpOnly cookie and is never part of the JSON body.
func (s *Server) writeClientAuthenticationResponse(w http.ResponseWriter, r *http.Request, pair domain.TokenPair, device string, status int) {
	if pair.Identity.Role != "client" || pair.Identity.Surface != "app-client" {
		writeDomainError(w, domain.ErrForbidden)
		return
	}
	if strings.TrimSpace(r.Header.Get("Origin")) != "" {
		if !s.clientWebOriginAllowed(r) {
			writeDomainError(w, domain.ErrForbidden)
			return
		}
		s.setClientWebCookiesIfAuthorized(w, r, pair, device)
		writeJSON(w, status, clientBrowserAccessPair{
			AccessToken: pair.AccessToken, AccessExpiry: pair.AccessExpiry, Identity: pair.Identity,
		})
		return
	}
	writeJSON(w, status, pair)
}
