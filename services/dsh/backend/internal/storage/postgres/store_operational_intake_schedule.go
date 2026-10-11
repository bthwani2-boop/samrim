package postgres

import (
	"encoding/json"
	"time"
)

// The intake uses ISO weekdays (Monday=1, Sunday=7) and local HH:mm.
// Orderability uses Go weekdays (Sunday=0) and half-open, same-day windows.
// Split overnight windows at midnight so the customer's orderability clock
// has exactly the same meaning as the approved joining-case schedule.
func operationalWindowsFromJoiningHours(raw json.RawMessage) ([]StoreScheduleWindow, error) {
	if !ValidateStoreWorkingHours(raw) {
		return nil, ErrStoreOperationalAvailabilityInvalid
	}
	var intake struct {
		Intervals []struct {
			DayOfWeek     int    `json:"dayOfWeek"`
			OpensAt       string `json:"opensAt"`
			ClosesAt      string `json:"closesAt"`
			ClosesNextDay bool   `json:"closesNextDay"`
		} `json:"intervals"`
	}
	if err := json.Unmarshal(raw, &intake); err != nil {
		return nil, err
	}
	windows := make([]StoreScheduleWindow, 0, len(intake.Intervals)*2)
	for _, interval := range intake.Intervals {
		open, err := time.Parse("15:04", interval.OpensAt)
		if err != nil {
			return nil, err
		}
		closeTime, err := time.Parse("15:04", interval.ClosesAt)
		if err != nil {
			return nil, err
		}
		start := open.Hour()*60 + open.Minute()
		finish := closeTime.Hour()*60 + closeTime.Minute()
		day := interval.DayOfWeek % 7
		if interval.ClosesNextDay {
			windows = append(windows, StoreScheduleWindow{DayOfWeek: day, OpensAtMinute: start, ClosesAtMinute: 1440})
			if finish > 0 {
				windows = append(windows, StoreScheduleWindow{DayOfWeek: (day + 1) % 7, OpensAtMinute: 0, ClosesAtMinute: finish})
			}
		} else {
			windows = append(windows, StoreScheduleWindow{DayOfWeek: day, OpensAtMinute: start, ClosesAtMinute: finish})
		}
	}
	return canonicalSchedule(windows), nil
}
