package session

import (
	"testing"
	"time"
)

func TestCalculateSessionExpiriesKeepStrictOrderingNearAbsoluteExpiry(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	absolute := now.Add(10 * time.Minute)
	access, refresh, ok := calculateSessionExpiries("client", now, absolute)
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
	access, refresh, ok := calculateSessionExpiries("client", now, now.Add(365*24*time.Hour))
	if !ok || access != now.Add(15*time.Minute) || refresh != now.Add(30*24*time.Hour) {
		t.Fatalf("safe session expiries = %s/%s/%t, want 15m/30d/true", access, refresh, ok)
	}
}

func TestCalculateSessionExpiriesFailClosedWithoutUsableAccessInterval(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	access, refresh, ok := calculateSessionExpiries("client", now, now.Add(1500*time.Millisecond))
	if ok || !access.IsZero() || !refresh.IsZero() {
		t.Fatalf("near-exhausted session lifetime was not rejected: access=%s refresh=%s ok=%t", access, refresh, ok)
	}
}

func TestMobileSessionLifetimesAreRoleAware(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	mobileAbsolute := now.Add(sessionAbsoluteLifetime("client"))
	if mobileAbsolute != now.Add(365*24*time.Hour) {
		t.Fatalf("mobile absolute lifetime = %s, want 365 days", mobileAbsolute.Sub(now))
	}
	if got := calculateRefreshExpiry("client", now, mobileAbsolute); got != now.Add(30*24*time.Hour) {
		t.Fatalf("mobile refresh lifetime = %s, want 30 days", got.Sub(now))
	}
	operatorAbsolute := now.Add(sessionAbsoluteLifetime("operator"))
	if operatorAbsolute != now.Add(24*time.Hour) {
		t.Fatalf("operator absolute lifetime = %s, want 24 hours", operatorAbsolute.Sub(now))
	}
	if got := calculateRefreshExpiry("operator", now, operatorAbsolute); got != now.Add(time.Hour) {
		t.Fatalf("operator refresh lifetime = %s, want 1 hour", got.Sub(now))
	}
}

func TestRefreshExpiryIsStrictlyBeforeAbsoluteExpiry(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	abs := now.Add(10 * time.Minute)
	got := calculateRefreshExpiry("client", now, abs)
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
