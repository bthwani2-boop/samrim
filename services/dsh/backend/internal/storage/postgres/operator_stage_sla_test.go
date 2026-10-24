package postgres

import (
	"testing"
	"time"
)

func TestEvaluateOperatorStageSLAUsesOnlyApprovedStageEvidence(t *testing.T) {
	now := time.Date(2026, 10, 24, 6, 0, 0, 0, time.UTC)
	start := now.Add(-48 * time.Minute)
	for _, tc := range []struct {
		name, state           string
		at                    *time.Time
		target, warn, version int
		want                  string
	}{
		{"no-policy", "PREPARING", &start, 0, 0, 0, "UNCONFIGURED"},
		{"no-event", "PREPARING", nil, 60, 15, 1, "MISSING_EVENT"},
		{"risk", "PREPARING", &start, 60, 15, 1, "AT_RISK"},
		{"overdue", "PREPARING", &start, 40, 10, 1, "OVERDUE"},
		{"on-track", "IN_CUSTODY", &start, 90, 15, 2, "ON_TRACK"},
		{"not-applicable", "DELIVERED", &start, 60, 15, 1, "NOT_APPLICABLE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := EvaluateOperatorStageSLA(now, tc.state, tc.at, tc.target, tc.warn, tc.version)
			if result.Status != tc.want {
				t.Fatalf("got %+v want %s", result, tc.want)
			}
			if tc.want == "UNCONFIGURED" || tc.want == "MISSING_EVENT" || tc.want == "NOT_APPLICABLE" {
				if result.DeadlineAt != nil {
					t.Fatalf("synthetic SLA deadline: %+v", result)
				}
			} else if result.DeadlineAt == nil || !result.DeadlineAt.Equal(start.Add(time.Duration(tc.target)*time.Minute)) {
				t.Fatalf("wrong stage deadline: %+v", result)
			}
		})
	}
}
