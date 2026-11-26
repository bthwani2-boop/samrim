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
		{"paused", `{"version":4,"paused":true}`, "PAUSED", 4},
		{"wrong timezone", `{"version":1,"timezone":"Local","weekly":[]}`, "UNAVAILABLE", 0},
		{"missing schedule", `{"version":2,"timezone":"UTC"}`, "UNAVAILABLE", 0},
		{"unsafe version", `{"version":9007199254740992,"paused":true}`, "UNAVAILABLE", 0},
		{"overlapping", `{"version":2,"timezone":"UTC","weekly":[{"weekday":2,"opens":0,"closes":600},{"weekday":2,"opens":300,"closes":720}]}`, "UNAVAILABLE", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := EvaluateCustomerSchedule(now, []byte(tc.raw))
			if result.Status != tc.want || result.Version != tc.version {
				t.Fatalf("got %+v, want %s/%d", result, tc.want, tc.version)
			}
		})
	}
}
