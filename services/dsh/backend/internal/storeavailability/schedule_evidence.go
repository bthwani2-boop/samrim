package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// PublicStoresWithScheduleSQL is the single static owner projection used by
// Store discovery and checkout. Selectors are bound; no SQL is composed at
// runtime. A schedule that is open does not authorize fulfillment or payment.
const PublicStoresWithScheduleSQL = `SELECT s.id,s.name,s.city_id,s.vertical_id,
 (SELECT CASE
 WHEN a.paused_until > transaction_timestamp() THEN jsonb_build_object('version',a.version,'pausedUntil',a.paused_until)
 WHEN a.preparation_minutes IS NOT NULL AND a.store_timezone=c.timezone_name THEN
 jsonb_build_object('version',a.version,'timezone',a.store_timezone,'weekly',COALESCE(
 (SELECT jsonb_agg(jsonb_build_object('weekday',h.weekday,'opens',h.opens_minute,'closes',h.closes_minute))
 FROM store_operational_weekly_hours h WHERE h.store_id=a.store_id),'[]'::jsonb))
 END FROM store_operational_availability a WHERE a.store_id=s.id),
 transaction_timestamp()
 FROM stores s
 JOIN service_cities c ON c.id=s.city_id
 JOIN verticals v ON v.id=s.vertical_id
 WHERE s.published AND c.active AND v.active
   AND (($1::text<>'' AND s.id=$1) OR ($1='' AND s.relation='MARKETPLACE'
     AND s.city_id=$2 AND s.id>$3
     AND ($4='' OR strpos(translate(lower(normalize(s.name)), $7, $8),
       NULLIF(translate(lower(normalize($4)), $7, $8), ''))>0)
     AND ($5='' OR s.vertical_id=$5)))
 ORDER BY s.id LIMIT $6`

// ReadCustomerSchedule selects one visible Store in the caller's existing
// repeatable-read owner transaction; it never opens a second snapshot.
func ReadCustomerSchedule(ctx context.Context, tx *sql.Tx, storeID string) (CustomerScheduleEvidence, error) {
	var id, name, cityID, verticalID string
	var raw []byte
	var now time.Time
	// Exact Store lookup does not use the marketplace search selectors.
	err := tx.QueryRowContext(ctx, PublicStoresWithScheduleSQL, storeID, "", "", "", "", 1, "", "").
		Scan(&id, &name, &cityID, &verticalID, &raw, &now)
	if err != nil {
		return CustomerScheduleEvidence{}, err
	}
	return EvaluateCustomerSchedule(now, raw), nil
}

type CustomerScheduleEvidence struct {
	Status      string     `json:"status"`
	Version     int64      `json:"version,omitempty"`
	PausedUntil *time.Time `json:"pausedUntil,omitempty"`
}

func EvaluateCustomerSchedule(now time.Time, raw []byte) CustomerScheduleEvidence {
	unavailable := CustomerScheduleEvidence{Status: "UNAVAILABLE"}
	var hours struct {
		Version     int64          `json:"version"`
		PausedUntil *time.Time     `json:"pausedUntil"`
		Timezone    string         `json:"timezone"`
		Weekly      []WeeklyWindow `json:"weekly"`
	}
	if json.Unmarshal(raw, &hours) != nil || hours.Version < 1 || hours.Version > 9007199254740991 {
		return unavailable
	}
	if hours.PausedUntil != nil {
		expires := hours.PausedUntil.UTC()
		if !expires.After(now) || expires.Year() < 1 || expires.Year() > 9999 {
			return unavailable
		}
		return CustomerScheduleEvidence{Status: "PAUSED", Version: hours.Version, PausedUntil: &expires}
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
