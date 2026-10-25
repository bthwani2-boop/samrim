package hr

import (
	"errors"
	"testing"
	"time"
)

func TestAttendanceDayMatchesYemenShiftStart(t *testing.T) {
	input := AttendanceInput{
		Date: "2026-10-24", Status: "present", Note: "Worked an overnight shift.",
		CheckInAt:  "2026-10-24T22:30:00+03:00",
		CheckOutAt: "2026-10-25T04:30:00+03:00",
	}
	normalized, start, finish, err := normalizeAttendance(input)
	if err != nil || start == nil || finish == nil || normalized.CheckInAt == "" {
		t.Fatalf("overnight attendance should be valid: %+v, %v", normalized, err)
	}
	input.Date = "2026-10-25"
	if _, _, _, err := normalizeAttendance(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("attendance recorded under the wrong Yemen-local shift date must fail: %v", err)
	}
}

func TestAttendanceRequiresActiveEmploymentOnOrAfterStart(t *testing.T) {
	start := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		day, status string
		allowed     bool
	}{
		{"2026-10-23", "active", false},
		{"2026-10-24", "active", true},
		{"2026-10-25", "active", true},
		{"2026-10-24", "inactive", false},
	} {
		if got := attendanceAllowedForEmployment(tc.day, tc.status, start); got != tc.allowed {
			t.Fatalf("day %s, status %s: got %v, want %v", tc.day, tc.status, got, tc.allowed)
		}
	}
}
