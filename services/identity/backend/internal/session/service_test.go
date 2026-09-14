package session

import (
	"testing"
	"time"
)

func TestCalculateAccessExpiryNeverOutlivesAbsoluteExpiry(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	absolute := now.Add(3 * time.Minute)
	got := calculateAccessExpiry(now, absolute)
	if !got.Before(absolute) {
		t.Fatalf("access expiry %s is not before absolute expiry %s", got, absolute)
	}
	if got != absolute.Add(-time.Second) {
		t.Fatalf("access expiry = %s, want %s", got, absolute.Add(-time.Second))
	}
}

func TestCalculateAccessExpiryUsesAccessLifetimeWhenSafe(t *testing.T) {
	now := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC)
	got := calculateAccessExpiry(now, now.Add(time.Hour))
	if got != now.Add(15*time.Minute) {
		t.Fatalf("access expiry = %s, want 15 minute access lifetime", got)
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
