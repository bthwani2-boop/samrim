package storeavailability

import (
	"errors"
	"testing"
	"time"
)

func baseInputs() Inputs {
	return Inputs{
		Published: true, CityActive: true, VerticalActive: true,
		OfferSellable: true, MethodAdmitted: true, MethodOperational: true,
		RecipientServiceable: true, Timezone: "Asia/Aden",
		Weekly: []WeeklyWindow{{Weekday: time.Monday, Opens: 9 * 60, Closes: 17 * 60}},
	}
}
func moment(t *testing.T, value string) time.Time {
	t.Helper()
	when, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return when
}
func TestDerivedStateIsNotStorePublication(t *testing.T) {
	now := moment(t, "2026-11-16T10:00:00+03:00")
	cases := []struct {
		name   string
		modify func(*Inputs)
		want   Status
	}{
		{"eligible open", func(*Inputs) {}, OpenForOrders},
		{"published but paused", func(i *Inputs) { until := now.Add(time.Hour); i.PausedUntil = &until }, Paused},
		{"unpublished", func(i *Inputs) { i.Published = false }, OperationallyUnavail},
		{"inactive city", func(i *Inputs) { i.CityActive = false }, OperationallyUnavail},
		{"inactive vertical", func(i *Inputs) { i.VerticalActive = false }, OperationallyUnavail},
		{"draft offer", func(i *Inputs) { i.OfferSellable = false }, OperationallyUnavail},
		{"not admitted method", func(i *Inputs) { i.MethodAdmitted = false }, OperationallyUnavail},
		{"method paused", func(i *Inputs) { i.MethodOperational = false }, OperationallyUnavail},
		{"outside delivery reach", func(i *Inputs) { i.RecipientServiceable = false }, OperationallyUnavail},
		{"published closed by hours", func(i *Inputs) { i.Weekly = []WeeklyWindow{{Weekday: time.Monday, Opens: 11 * 60, Closes: 12 * 60}} }, ClosedBySchedule},
		{"no invented weekly hours", func(i *Inputs) { i.Weekly = nil }, ClosedBySchedule},
		{"pause expired", func(i *Inputs) { past := now.Add(-time.Minute); i.PausedUntil = &past }, OpenForOrders},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := baseInputs()
			tc.modify(&in)
			got, err := EvaluatedAt(now, in)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.want || got.Orderable != (tc.want == OpenForOrders) {
				t.Fatalf("got %+v want %s", got, tc.want)
			}
		})
	}
}
func TestOvernightAndBoundaryTime(t *testing.T) {
	in := baseInputs()
	in.Weekly = []WeeklyWindow{{Weekday: time.Monday, Opens: 22 * 60, Closes: 2 * 60}}
	for _, c := range []struct {
		ts       string
		expected Status
	}{
		{"2026-11-16T21:59:00+03:00", ClosedBySchedule},
		{"2026-11-16T22:00:00+03:00", OpenForOrders},
		{"2026-11-17T01:59:00+03:00", OpenForOrders},
		{"2026-11-17T02:00:00+03:00", ClosedBySchedule},
	} {
		got, err := EvaluatedAt(moment(t, c.ts), in)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != c.expected {
			t.Errorf("%s got %s want %s", c.ts, got.Status, c.expected)
		}
	}
}
func TestSaturdayWrapAndScheduleOverlap(t *testing.T) {
	in := baseInputs()
	in.Weekly = []WeeklyWindow{{Weekday: time.Saturday, Opens: 23 * 60, Closes: 1 * 60}}
	got, err := EvaluatedAt(moment(t, "2026-11-15T00:30:00+03:00"), in)
	if err != nil || got.Status != OpenForOrders {
		t.Fatalf("week wrap: %+v %v", got, err)
	}
	in.Weekly = append(in.Weekly, WeeklyWindow{Weekday: time.Sunday, Opens: 30, Closes: 120})
	if err := ValidateSchedule(in.Weekly); !errors.Is(err, ErrInvalidSchedule) {
		t.Fatalf("overlap: %v", err)
	}
}
func TestInvalidScheduleAndTimezoneFailClosed(t *testing.T) {
	for _, tc := range [][]WeeklyWindow{
		{{Weekday: 7, Opens: 60, Closes: 100}},
		{{Weekday: time.Monday, Opens: 60, Closes: 60}},
		{{Weekday: time.Monday, Opens: -1, Closes: 100}},
		{{Weekday: time.Monday, Opens: 500, Closes: 400}, {Weekday: time.Tuesday, Opens: 300, Closes: 360}},
	} {
		in := baseInputs()
		in.Weekly = tc
		got, err := EvaluatedAt(moment(t, "2026-11-16T10:00:00+03:00"), in)
		if !errors.Is(err, ErrInvalidSchedule) || got.Orderable {
			t.Fatalf("invalid schedule gave %+v err %v", got, err)
		}
	}
	in := baseInputs()
	in.Timezone = "Not/AZone"
	got, err := EvaluatedAt(moment(t, "2026-11-16T10:00:00+03:00"), in)
	if !errors.Is(err, ErrInvalidTimezone) || got.Orderable {
		t.Fatalf("invalid tz gave %+v err %v", got, err)
	}
}
