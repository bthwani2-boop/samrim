package storeavailability

import (
	"encoding/json"
	"time"
)

// PublicScheduleSQL is a shared projection over the canonical Store schedule.
// The enclosing query binds s=stores and c=service_cities and verifies visibility.
// A schedule that is open does not authorize fulfillment or payment.
const PublicScheduleSQL = `(SELECT CASE
 WHEN a.paused_until > transaction_timestamp() THEN jsonb_build_object('version',a.version,'paused',true)
 WHEN a.preparation_minutes IS NOT NULL AND a.store_timezone=c.timezone_name THEN
 jsonb_build_object('version',a.version,'timezone',a.store_timezone,'weekly',COALESCE(
 (SELECT jsonb_agg(jsonb_build_object('weekday',h.weekday,'opens',h.opens_minute,'closes',h.closes_minute))
 FROM store_operational_weekly_hours h WHERE h.store_id=a.store_id),'[]'::jsonb))
 END FROM store_operational_availability a WHERE a.store_id=s.id)`

type CustomerScheduleEvidence struct {
	Status  string `json:"status"`
	Version int64  `json:"version,omitempty"`
}

func EvaluateCustomerSchedule(now time.Time, raw []byte) CustomerScheduleEvidence {
	unavailable := CustomerScheduleEvidence{Status: "UNAVAILABLE"}
	var hours struct {
		Version  int64          `json:"version"`
		Paused   bool           `json:"paused"`
		Timezone string         `json:"timezone"`
		Weekly   []WeeklyWindow `json:"weekly"`
	}
	if json.Unmarshal(raw, &hours) != nil || hours.Version < 1 || hours.Version > 9007199254740991 {
		return unavailable
	}
	if hours.Paused {
		return CustomerScheduleEvidence{Status: "PAUSED", Version: hours.Version}
	}
	if hours.Weekly == nil {
		return unavailable
	}
	open, err := WithinWeeklyHours(now, hours.Timezone, hours.Weekly)
	if err != nil {
		return unavailable
	}
	if open {
		return CustomerScheduleEvidence{Status: "OPEN_BY_SCHEDULE", Version: hours.Version}
	}
	return CustomerScheduleEvidence{Status: "CLOSED_BY_SCHEDULE", Version: hours.Version}
}
