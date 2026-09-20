package session

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
)

func TestCalculateSessionExpiriesKeepStrictOrderingNearAbsoluteExpiry(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	absolute := now.Add(10 * time.Minute)
	access, refresh, ok := calculateSessionExpiries("client", now, absolute, false)
	if !ok {
		t.Fatal("session expiry calculation unexpectedly failed with a usable absolute lifetime")
	}
	if !access.Before(refresh) || !refresh.Before(absolute) {
		t.Fatalf("session expiry ordering violated: access=%s refresh=%s absolute=%s", access, refresh, absolute)
	}
	if access != absolute.Add(-2*time.Second) || refresh != absolute.Add(-time.Second) {
		t.Fatalf("near-ceiling expiries = %s/%s, want %s/%s", access, refresh, absolute.Add(-2*time.Second), absolute.Add(-time.Second))
	}
}

func TestCalculateSessionExpiriesUseConfiguredLifetimesWhenSafe(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	access, refresh, ok := calculateSessionExpiries("client", now, now.Add(365*24*time.Hour), false)
	if !ok || access != now.Add(15*time.Minute) || refresh != now.Add(30*24*time.Hour) {
		t.Fatalf("safe session expiries = %s/%s/%t, want 15m/30d/true", access, refresh, ok)
	}
}

func TestCalculateSessionExpiriesFailClosedWithoutUsableAccessInterval(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	access, refresh, ok := calculateSessionExpiries("client", now, now.Add(1500*time.Millisecond), false)
	if ok || !access.IsZero() || !refresh.IsZero() {
		t.Fatalf("near-exhausted session lifetime was not rejected: access=%s refresh=%s ok=%t", access, refresh, ok)
	}
}

func TestMobileSessionLifetimesAreRoleAware(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	mobileAbsolute := now.Add(sessionAbsoluteLifetime("client", false))
	if mobileAbsolute != now.Add(365*24*time.Hour) {
		t.Fatalf("mobile absolute lifetime = %s, want 365 days", mobileAbsolute.Sub(now))
	}
	if got := calculateRefreshExpiry("client", now, mobileAbsolute, false); got != now.Add(30*24*time.Hour) {
		t.Fatalf("mobile refresh lifetime = %s, want 30 days", got.Sub(now))
	}
	operatorAbsolute := now.Add(sessionAbsoluteLifetime("operator", false))
	if operatorAbsolute != now.Add(24*time.Hour) {
		t.Fatalf("operator absolute lifetime = %s, want 24 hours", operatorAbsolute.Sub(now))
	}
	if got := calculateRefreshExpiry("operator", now, operatorAbsolute, false); got != now.Add(time.Hour) {
		t.Fatalf("operator refresh lifetime = %s, want 1 hour", got.Sub(now))
	}
	developmentOperatorAbsolute := now.Add(sessionAbsoluteLifetime("operator", true))
	if developmentOperatorAbsolute != now.Add(365*24*time.Hour) {
		t.Fatalf("development operator absolute lifetime = %s, want 365 days", developmentOperatorAbsolute.Sub(now))
	}
	if got := calculateRefreshExpiry("operator", now, developmentOperatorAbsolute, true); got != now.Add(30*24*time.Hour) {
		t.Fatalf("development operator refresh lifetime = %s, want 30 days", got.Sub(now))
	}
}

func TestRefreshExpiryIsStrictlyBeforeAbsoluteExpiry(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	abs := now.Add(10 * time.Minute)
	got := calculateRefreshExpiry("client", now, abs, false)
	if got != abs.Add(-time.Second) || !got.Before(abs) {
		t.Fatalf("refresh expiry = %s, want one second before absolute expiry %s", got, abs.Add(-time.Second))
	}
}

func TestWithinRefreshRaceGraceAcceptsRecentHistoryOnly(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	if !withinRefreshRaceGrace(now, now.Add(-refreshRaceGrace)) {
		t.Fatal("refresh history at the grace boundary should be stale-safe")
	}
	if withinRefreshRaceGrace(now, now.Add(-(refreshRaceGrace + time.Nanosecond))) {
		t.Fatal("refresh history outside the grace window should be replay-compromising")
	}
	if withinRefreshRaceGrace(now, now.Add(time.Nanosecond)) {
		t.Fatal("future refresh history should not be stale-safe")
	}
}

func TestDerivedRefreshPairIsStablePerSessionGenerationAndInstance(t *testing.T) {
	service := &Service{refreshSecret: []byte("01234567890123456789012345678901")}
	expires := time.Date(2026, time.January, 1, 12, 15, 0, 0, time.UTC)
	first := service.derivedRefreshPair("session-1", "actor-1", "client", "device-hash-1", 2, expires)
	retry := service.derivedRefreshPair("session-1", "actor-1", "client", "device-hash-1", 2, expires)
	next := service.derivedRefreshPair("session-1", "actor-1", "client", "device-hash-1", 3, expires)
	otherDevice := service.derivedRefreshPair("session-1", "actor-1", "client", "device-hash-2", 2, expires)

	if first.AccessToken != retry.AccessToken || first.RefreshToken != retry.RefreshToken {
		t.Fatal("reconciliation did not reproduce the same token pair")
	}
	if first.AccessToken == next.AccessToken || first.RefreshToken == next.RefreshToken {
		t.Fatal("different session generations share token material")
	}
	if first.AccessToken == otherDevice.AccessToken || first.RefreshToken == otherDevice.RefreshToken {
		t.Fatal("different client instances share token material")
	}
	if parts := strings.Split(first.RefreshToken, "."); len(parts) != 2 || parts[0] != "session-1" {
		t.Fatalf("derived refresh token format = %q", first.RefreshToken)
	}
}

func TestLegacyDevelopmentOperatorSessionCutoverIsNarrow(t *testing.T) {
	createdAt := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	legacyRefresh := createdAt.Add(time.Hour)
	legacyAbsolute := createdAt.Add(24 * time.Hour)
	if !shouldCutOverLegacyDevelopmentOperatorSession("operator", createdAt, legacyRefresh, legacyAbsolute, true) {
		t.Fatal("legacy development operator session was not selected for one-time policy cutover")
	}
	if shouldCutOverLegacyDevelopmentOperatorSession("operator", createdAt, legacyRefresh, legacyAbsolute, false) {
		t.Fatal("non-development operator session was selected for development policy cutover")
	}
	if shouldCutOverLegacyDevelopmentOperatorSession("client", createdAt, legacyRefresh, legacyAbsolute, true) {
		t.Fatal("mobile role was selected for operator-only policy cutover")
	}
	if shouldCutOverLegacyDevelopmentOperatorSession("operator", createdAt, createdAt.Add(30*24*time.Hour), createdAt.Add(365*24*time.Hour), true) {
		t.Fatal("already-current development operator session was selected for legacy cutover")
	}
}

func TestCreateDevelopmentSessionRejectsNonDevelopmentBeforeDatabaseAccess(t *testing.T) {
	service := &Service{development: false}
	_, err := service.CreateDevelopment(context.Background(), "client", "development-client-instance")
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("CreateDevelopment() error = %v, want forbidden outside development", err)
	}
}

func TestRoleSessionReadyRequiresCanonicalEnrollmentFacts(t *testing.T) {
	ready := roleSessionReadiness{enabled: true, securityEnabled: true}
	cases := []struct {
		name string
		role string
		readiness roleSessionReadiness
		want bool
	}{
		{"client credential", "client", roleSessionReadiness{enabled:true, securityEnabled:true, passwordCredential:true}, true},
		{"client bare role", "client", ready, false},
		{"partner activated credential", "partner", roleSessionReadiness{enabled:true, securityEnabled:true, activated:true, passwordCredential:true}, true},
		{"partner pending activation", "partner", roleSessionReadiness{enabled:true, securityEnabled:true, passwordCredential:true}, false},
		{"captain activated credential", "captain", roleSessionReadiness{enabled:true, securityEnabled:true, activated:true, passwordCredential:true}, true},
		{"field activated credential", "field", roleSessionReadiness{enabled:true, securityEnabled:true, activated:true, passwordCredential:true}, true},
		{"operator enrolled passkey", "operator", roleSessionReadiness{enabled:true, securityEnabled:true, activated:true, passkeyCredential:true}, true},
		{"operator bootstrap only", "operator", roleSessionReadiness{enabled:true, securityEnabled:true}, false},
		{"disabled role", "captain", roleSessionReadiness{securityEnabled:true, activated:true, passwordCredential:true}, false},
		{"disabled security", "captain", roleSessionReadiness{enabled:true, activated:true, passwordCredential:true}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := roleSessionReady(tc.role, tc.readiness); got != tc.want {
				t.Fatalf("roleSessionReady(%q) = %t, want %t", tc.role, got, tc.want)
			}
		})
	}
}
