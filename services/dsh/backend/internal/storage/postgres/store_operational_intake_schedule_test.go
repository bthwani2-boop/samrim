package postgres

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestOperationalWindowsFromJoiningHours(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []StoreScheduleWindow
	}{
		{"simple weekday", `{"intervals":[{"dayOfWeek":1,"opensAt":"08:00","closesAt":"17:00","closesNextDay":false}]}`, []StoreScheduleWindow{{DayOfWeek: 1, OpensAtMinute: 480, ClosesAtMinute: 1020}}},
		{"sunday to monday", `{"intervals":[{"dayOfWeek":7,"opensAt":"22:00","closesAt":"02:00","closesNextDay":true}]}`, []StoreScheduleWindow{{DayOfWeek: 0, OpensAtMinute: 1320, ClosesAtMinute: 1440}, {DayOfWeek: 1, OpensAtMinute: 0, ClosesAtMinute: 120}}},
		{"saturday to sunday", `{"intervals":[{"dayOfWeek":6,"opensAt":"21:30","closesAt":"00:30","closesNextDay":true}]}`, []StoreScheduleWindow{{DayOfWeek: 0, OpensAtMinute: 0, ClosesAtMinute: 30}, {DayOfWeek: 6, OpensAtMinute: 1290, ClosesAtMinute: 1440}}},
		{"full day from midnight", `{"intervals":[{"dayOfWeek":5,"opensAt":"00:00","closesAt":"00:00","closesNextDay":true}]}`, []StoreScheduleWindow{{DayOfWeek: 5, OpensAtMinute: 0, ClosesAtMinute: 1440}}},
		{"multi-period", `{"intervals":[{"dayOfWeek":2,"opensAt":"08:00","closesAt":"12:00","closesNextDay":false},{"dayOfWeek":2,"opensAt":"15:00","closesAt":"19:00","closesNextDay":false}]}`, []StoreScheduleWindow{{DayOfWeek: 2, OpensAtMinute: 480, ClosesAtMinute: 720}, {DayOfWeek: 2, OpensAtMinute: 900, ClosesAtMinute: 1140}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := operationalWindowsFromJoiningHours(json.RawMessage(tc.raw))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("windows=%v; want=%v", got, tc.want)
			}
			for _, w := range got {
				if w.ClosesAtMinute <= w.OpensAtMinute {
					t.Fatalf("invalid window: %v", w)
				}
			}
		})
	}
}

func TestInitialOvernightOrderabilityFollowsAdenClock(t *testing.T) {
	raw := json.RawMessage(`{"intervals":[{"dayOfWeek":7,"opensAt":"22:00","closesAt":"02:00","closesNextDay":true}]}`)
	windows, err := operationalWindowsFromJoiningHours(raw)
	if err != nil {
		t.Fatal(err)
	}
	// Local Sunday 23:00, Monday 01:00 and Monday 03:00.
	sunday := time.Date(2026, 10, 11, 20, 0, 0, 0, time.UTC)
	if !scheduleContains(windows, sunday) || !scheduleContains(windows, sunday.Add(2*time.Hour)) {
		t.Fatal("must remain open across Sunday/Monday midnight")
	}
	if scheduleContains(windows, sunday.Add(4*time.Hour)) {
		t.Fatal("must be closed after 02:00 Aden")
	}
}

func TestInvalidIntakeCannotCreateOperationalSchedule(t *testing.T) {
	for _, raw := range []string{`{"intervals":[]}`, `{"intervals":[{"dayOfWeek":7,"opensAt":"23:00","closesAt":"23:30","closesNextDay":true}]}`} {
		if _, err := operationalWindowsFromJoiningHours(json.RawMessage(raw)); err == nil {
			t.Fatalf("invalid intake accepted: %s", raw)
		}
	}
}
