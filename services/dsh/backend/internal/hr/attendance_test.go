package hr

import (
	"errors"
	"testing"
	"time"
)

func TestManualAttendanceInputValidation(t *testing.T) {
	valid := AttendanceInput{Date: "2026-10-12", Status: "present", Note: "الحضور مثبت من سجل الموارد", ExpectedVersion: 0}
	normalized, in, out, err := normalizeAttendance(valid)
	if err != nil || in != nil || out != nil || normalized.Date != valid.Date {
		t.Fatalf("valid manual record rejected: %v", err)
	}
	scenarios := []struct {
		name   string
		mutate func(*AttendanceInput)
	}{
		{"invalid date", func(x *AttendanceInput) { x.Date = "2026-02-30" }},
		{"missing date", func(x *AttendanceInput) { x.Date = "" }},
		{"unknown status", func(x *AttendanceInput) { x.Status = "unreported" }},
		{"short reason", func(x *AttendanceInput) { x.Note = "قصير" }},
		{"negative version", func(x *AttendanceInput) { x.ExpectedVersion = -1 }},
		{"orphan checkin", func(x *AttendanceInput) { x.CheckInAt = "2026-10-12T08:00:00+03:00" }},
		{"false absence clock", func(x *AttendanceInput) {
			x.Status = "absent"
			x.CheckInAt = "2026-10-12T08:00:00+03:00"
			x.CheckOutAt = "2026-10-12T16:00:00+03:00"
		}},
		{"reverse time", func(x *AttendanceInput) {
			x.CheckInAt = "2026-10-12T16:00:00+03:00"
			x.CheckOutAt = "2026-10-12T08:00:00+03:00"
		}},
		{"too long overnight", func(x *AttendanceInput) {
			x.CheckInAt = "2026-10-12T08:00:00+03:00"
			x.CheckOutAt = "2026-10-14T09:00:00+03:00"
		}},
	}
	for _, tt := range scenarios {
		t.Run(tt.name, func(t *testing.T) {
			v := valid
			tt.mutate(&v)
			_, _, _, err := normalizeAttendance(v)
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("invalid manual attendance accepted: %v", err)
			}
		})
	}
	overnight := valid
	overnight.CheckInAt = "2026-10-12T22:00:00+03:00"
	overnight.CheckOutAt = "2026-10-13T06:00:00+03:00"
	_, started, ended, err := normalizeAttendance(overnight)
	if err != nil || started == nil || ended == nil || ended.Sub(*started) != 8*time.Hour {
		t.Fatalf("legitimate overnight manual times rejected: %v", err)
	}
}
