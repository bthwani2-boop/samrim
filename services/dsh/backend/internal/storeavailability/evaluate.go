package storeavailability

import (
	"errors"
	"fmt"
	"time"
)

// Orderability is derived by DSH for one Store/fulfillment method; no UI may persist it.
type Status string

const (
	OpenForOrders        Status = "OPEN_FOR_ORDERS"
	ClosedBySchedule     Status = "CLOSED_BY_SCHEDULE"
	Paused               Status = "PAUSED"
	OperationallyUnavail Status = "OPERATIONALLY_UNAVAILABLE"
)

var (
	ErrInvalidSchedule = errors.New("INVALID_WEEKLY_SCHEDULE")
	ErrInvalidTimezone = errors.New("INVALID_STORE_TIMEZONE")
)

// loadStoreTimezone rejects Go's process-dependent "Local" alias. Store hours
// require a stable, explicit IANA zone from DSH's canonical service city.
func loadStoreTimezone(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, ErrInvalidTimezone
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, ErrInvalidTimezone
	}
	return location, nil
}

// WeeklyWindow is [Opens, Closes) in local wall-clock minutes. If Closes < Opens,
// it continues after midnight into the next weekday. Closes=1440 means midnight.
type WeeklyWindow struct {
	Weekday time.Weekday `json:"weekday"`
	Opens   int          `json:"opens"`
	Closes  int          `json:"closes"`
}

type Inputs struct {
	// Each condition must come from the DSH owner at evaluation, not client flags.
	Published            bool
	CityActive           bool
	VerticalActive       bool
	OfferSellable        bool
	MethodAdmitted       bool
	MethodOperational    bool
	RecipientServiceable bool
	Timezone             string
	Weekly               []WeeklyWindow
	PausedUntil          *time.Time
}

type Result struct {
	Status    Status `json:"status"`
	Orderable bool   `json:"orderable"`
}

// ValidateSchedule rejects overlapping or ambiguous weekly intervals, even across
// Saturday/Sunday boundaries. Empty schedules intentionally mean closed.
func ValidateSchedule(windows []WeeklyWindow) error {
	minutes := make([]bool, 7*24*60)
	for _, slot := range windows {
		if slot.Weekday < time.Sunday || slot.Weekday > time.Saturday ||
			slot.Opens < 0 || slot.Opens >= 1440 ||
			slot.Closes < 0 || slot.Closes > 1440 ||
			slot.Opens == slot.Closes {
			return fmt.Errorf("%w: invalid interval", ErrInvalidSchedule)
		}
		end := slot.Closes
		if end < slot.Opens {
			end += 1440
		}
		start := int(slot.Weekday)*1440 + slot.Opens
		for minute := start; minute < int(slot.Weekday)*1440+end; minute++ {
			i := minute % len(minutes)
			if minutes[i] {
				return fmt.Errorf("%w: overlap", ErrInvalidSchedule)
			}
			minutes[i] = true
		}
	}
	return nil
}

func EvaluatedAt(now time.Time, in Inputs) (Result, error) {
	fail := Result{Status: OperationallyUnavail, Orderable: false}
	if err := ValidateSchedule(in.Weekly); err != nil {
		return fail, err
	}
	loc, err := loadStoreTimezone(in.Timezone)
	if err != nil {
		return fail, err
	}
	if !in.Published || !in.CityActive || !in.VerticalActive ||
		!in.OfferSellable || !in.MethodAdmitted || !in.MethodOperational || !in.RecipientServiceable {
		return fail, nil
	}
	if in.PausedUntil != nil && now.Before(*in.PausedUntil) {
		return Result{Status: Paused}, nil
	}
	local := now.In(loc)
	minuteOfWeek := int(local.Weekday())*1440 + local.Hour()*60 + local.Minute()
	for _, slot := range in.Weekly {
		start := int(slot.Weekday)*1440 + slot.Opens
		end := int(slot.Weekday)*1440 + slot.Closes
		if slot.Closes < slot.Opens {
			end += 1440
		}
		current := minuteOfWeek
		if current < start {
			current += 7 * 1440
		}
		if current >= start && current < end {
			return Result{Status: OpenForOrders, Orderable: true}, nil
		}
	}
	return Result{Status: ClosedBySchedule}, nil
}
