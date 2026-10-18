package postgres

import (
	"testing"
	"time"
)

func TestCaptainTrackingIsFresh(t *testing.T) {
	now := time.Date(2026, time.October, 19, 8, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		at   time.Time
		want bool
	}{
		{name: "just reported", at: now, want: true},
		{name: "recent", at: now.Add(-5 * time.Minute), want: true},
		{name: "freshness boundary", at: now.Add(-15 * time.Minute), want: true},
		{name: "expired", at: now.Add(-15*time.Minute - time.Nanosecond), want: false},
		{name: "old", at: now.Add(-24 * time.Hour), want: false},
		{name: "future timestamp", at: now.Add(time.Second), want: false},
		{name: "unset timestamp", at: time.Time{}, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := captainTrackingIsFresh(tc.at, now); got != tc.want {
				t.Fatalf("tracking freshness = %v, want %v", got, tc.want)
			}
		})
	}
}
