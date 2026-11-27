package storeavailability

import (
	"testing"
	"time"
)

func TestCustomerScheduleEvidence(t *testing.T) {
	now := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name, raw, want string
		version         int64
	}{
		{"missing", "", "UNAVAILABLE", 0},
		{"missing version", `{"timezone":"UTC","weekly":[]}`, "UNAVAILABLE", 0},
		{"closed", `{"version":3,"timezone":"UTC","weekly":[]}`, "CLOSED_BY_SCHEDULE", 3},
		{"open", `{"version":3,"timezone":"UTC","weekly":[{"weekday":2,"opens":540,"closes":600}]}`, "OPEN_BY_SCHEDULE", 3},
		{"paused", `{"version":4,"pausedUntil":"2026-11-24T13:00:00.000001+03:00","timezone":"UTC","weekly":[{"weekday":2,"opens":540,"closes":660}]}`, "PAUSED", 4},
		{"pause ends now", `{"version":4,"pausedUntil":"2026-11-24T09:00:00Z"}`, "UNAVAILABLE", 0},
		{"invalid pause", `{"version":4,"pausedUntil":"infinity"}`, "UNAVAILABLE", 0},
		{"wrong timezone", `{"version":1,"timezone":"Local","weekly":[]}`, "UNAVAILABLE", 0},
		{"missing schedule", `{"version":2,"timezone":"UTC"}`, "UNAVAILABLE", 0},
		{"unsafe version", `{"version":9007199254740992,"pausedUntil":"2026-11-24T10:00:00Z"}`, "UNAVAILABLE", 0},
		{"overlapping", `{"version":2,"timezone":"UTC","weekly":[{"weekday":2,"opens":0,"closes":600},{"weekday":2,"opens":300,"closes":720}]}`, "UNAVAILABLE", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := EvaluateCustomerSchedule(now, []byte(tc.raw))
			if result.Status != tc.want || result.Version != tc.version {
				t.Fatalf("got %+v, want %s/%d", result, tc.want, tc.version)
			}
			if tc.want == "PAUSED" {
				if result.PausedUntil == nil || result.PausedUntil.Format(time.RFC3339Nano) != "2026-11-24T10:00:00.000001Z" {
					t.Fatalf("expected exact UTC expiry, got %v", result.PausedUntil)
				}
			} else if result.PausedUntil != nil {
				t.Fatalf("non-paused evidence returned expiry %v", result.PausedUntil)
			}
		})
	}
}
