package postgres

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Each cell is an aggregated geographic region. Never expose individual
// Captain fixes, Store IDs, Customer destinations or exact sample counts.
type CaptainOpportunityCell struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Intensity string  `json:"intensity"`
	Kind      string  `json:"kind"`
}

type CaptainOpportunityHeatmap struct {
	Cells         []CaptainOpportunityCell `json:"cells"`
	MeasuredAt    time.Time                `json:"measuredAt"`
	WindowStart   time.Time                `json:"windowStart"`
	WindowEnd     time.Time                `json:"windowEnd"`
	SignalType    string                   `json:"signalType"`
	SampleStatus  string                   `json:"sampleStatus"`
	PolicyVersion string                   `json:"policyVersion"`
}

const opportunityGridDegrees = 0.05 // approx. 5.5 km north/south, never an exact location.

func captainOpportunityIntensity(count int64) string {
	if count >= 20 {
		return "HIGH"
	}
	if count >= 10 {
		return "MEDIUM"
	}
	return "LOW"
}

// ReadCaptainOpportunityHeatmap returns two short-lived, privacy-gated layers:
// (1) recent platform delivery demand by Store origin (30 minutes) and
// (2) *available* Captains' most recent, authorized dispatch fixes (15 minutes).
// No actor locations, trajectories, raw counts, Store IDs or homes leave DSH.
// An empty cell means insufficient privacy-safe evidence, not zero demand.
func ReadCaptainOpportunityHeatmap(ctx context.Context, db *sql.DB) (CaptainOpportunityHeatmap, error) {
	if db == nil {
		return CaptainOpportunityHeatmap{}, errors.New("opportunity heatmap database unavailable")
	}
	end := time.Now().UTC()
	start := end.Add(-30 * time.Minute)
	result := CaptainOpportunityHeatmap{
		Cells:      make([]CaptainOpportunityCell, 0),
		MeasuredAt: end, WindowStart: start, WindowEnd: end,
		SignalType: "RECENT_ACTIVITY", SampleStatus: "INSUFFICIENT_DATA",
		PolicyVersion: "RECENT_COARSE_V2",
	}

	// Do not reveal sparse demand: require at least six distinct orders
	// originating from at least three independent published Stores per cell.
	orders, err := db.QueryContext(ctx, `
SELECT floor(s.delivery_origin_latitude::double precision / 0.05)::integer,
       floor(s.delivery_origin_longitude::double precision / 0.05)::integer,
       count(*)::bigint
FROM dsh.commerce_orders o
JOIN dsh.stores s ON s.id=o.store_id
   AND s.publication_state='published' AND s.deleted_at IS NULL
JOIN dsh.service_cities city ON city.id=o.service_city_id
   AND city.id=s.service_city_id AND city.active=true
WHERE o.fulfillment_mode='BTHWANI_CAPTAIN'
  AND o.state NOT IN ('CANCELLED','REJECTED')
  AND o.created_at >= $1 AND o.created_at < $2
  AND s.delivery_origin_latitude IS NOT NULL
  AND s.delivery_origin_longitude IS NOT NULL
GROUP BY 1,2
HAVING count(*)>=6 AND count(DISTINCT o.store_id)>=3
ORDER BY count(*) DESC, 1,2 LIMIT 100`, start, end)
	if err != nil {
		return CaptainOpportunityHeatmap{}, err
	}
	for orders.Next() {
		var latCell, lngCell int
		var count int64
		if err := orders.Scan(&latCell, &lngCell, &count); err != nil {
			_ = orders.Close()
			return CaptainOpportunityHeatmap{}, err
		}
		result.Cells = append(result.Cells, CaptainOpportunityCell{
			Latitude:  (float64(latCell) + 0.5) * opportunityGridDegrees,
			Longitude: (float64(lngCell) + 0.5) * opportunityGridDegrees,
			Intensity: captainOpportunityIntensity(count), Kind: "ORDERS",
		})
	}
	err = orders.Err()
	_ = orders.Close()
	if err != nil {
		return CaptainOpportunityHeatmap{}, err
	}

	// The platform's existing dispatch-presence owner stores only the latest
	// foreground fix. Suppress cells with fewer than four available Captains.
	// A Captain with an active offer/assignment is not available for new work.
	captains, err := db.QueryContext(ctx, `
SELECT floor(p.latitude::double precision / 0.05)::integer,
       floor(p.longitude::double precision / 0.05)::integer,
       count(*)::bigint
FROM dsh.captain_presence_latest p
JOIN dsh.captain_admissions a ON a.actor_id=p.captain_actor_id
WHERE a.state='eligible' AND a.availability_state='available'
  AND a.requires_profile_review=false
  AND p.updated_at > $1 AND p.updated_at <= $2
  AND NOT EXISTS (
      SELECT 1 FROM dsh.captain_dispatch_offers off
      WHERE off.captain_actor_id=a.actor_id AND off.state='offered'
  )
  AND NOT EXISTS (
      SELECT 1 FROM dsh.captain_assignments ca
      WHERE ca.captain_actor_id=a.actor_id AND ca.state IN ('assigned','in_custody')
  )
GROUP BY 1,2
HAVING count(*)>=4
ORDER BY count(*) DESC, 1,2 LIMIT 100`, end.Add(-15*time.Minute), end)
	if err != nil {
		return CaptainOpportunityHeatmap{}, err
	}
	for captains.Next() {
		var latCell, lngCell int
		var count int64
		if err := captains.Scan(&latCell, &lngCell, &count); err != nil {
			_ = captains.Close()
			return CaptainOpportunityHeatmap{}, err
		}
		result.Cells = append(result.Cells, CaptainOpportunityCell{
			Latitude:  (float64(latCell) + 0.5) * opportunityGridDegrees,
			Longitude: (float64(lngCell) + 0.5) * opportunityGridDegrees,
			Intensity: captainOpportunityIntensity(count), Kind: "CAPTAINS",
		})
	}
	err = captains.Err()
	_ = captains.Close()
	if err != nil {
		return CaptainOpportunityHeatmap{}, err
	}
	if len(result.Cells) > 0 {
		result.SampleStatus = "AVAILABLE"
	}
	return result, nil
}
