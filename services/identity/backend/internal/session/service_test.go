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
