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
