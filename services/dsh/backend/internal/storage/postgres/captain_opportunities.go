package postgres

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// CaptainOpportunityCell represents a coarse area of Store-origin activity,
// never a Captain, Customer address, individual Store or identifiable Order.
type CaptainOpportunityCell struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Intensity string  `json:"intensity"`
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

func captainOpportunityIntensity(orderCount int64) string {
	if orderCount >= 20 {
		return "HIGH"
	}
	if orderCount >= 10 {
		return "MEDIUM"
	}
	return "LOW"
}

// This is a fixed, historical, day-bucketed view (no user-selected zoom or
// temporal window). At least six orders from three independent Stores in
// each ~11 km grid cell are required to prevent low-sample location exposure.
// Counts, actors, addresses, Store identifiers and Captain GPS are never sent.
func ReadCaptainOpportunityHeatmap(ctx context.Context, db *sql.DB) (CaptainOpportunityHeatmap, error) {
	if db == nil {
		return CaptainOpportunityHeatmap{}, errors.New("opportunity heatmap database unavailable")
	}
	end := time.Now().UTC().Truncate(24 * time.Hour)
	start := end.AddDate(0, 0, -7)
	result := CaptainOpportunityHeatmap{
		Cells:      make([]CaptainOpportunityCell, 0),
		MeasuredAt: end, WindowStart: start, WindowEnd: end,
		SignalType:    "HISTORICAL_ACTIVITY",
		SampleStatus:  "INSUFFICIENT_DATA",
		PolicyVersion: "STORE_ORIGIN_V1",
	}
	rows, err := db.QueryContext(ctx, `SELECT floor(s.delivery_origin_latitude::double precision / 0.10)::integer,
			floor(s.delivery_origin_longitude::double precision / 0.10)::integer,
			count(DISTINCT o.id)::bigint
		FROM dsh.commerce_orders o
		JOIN dsh.stores s ON s.id=o.store_id AND s.publication_state='published' AND s.deleted_at IS NULL
		JOIN dsh.service_cities city ON city.id=o.service_city_id AND city.id=s.service_city_id AND city.active=true
		WHERE o.fulfillment_mode='BTHWANI_CAPTAIN'
		  AND o.state IN ('CREATED','PARTNER_ACCEPTED','PREPARING','READY_FOR_DISPATCH','CAPTAIN_ASSIGNED','IN_CUSTODY','DELIVERED')
		  AND o.created_at >= $1 AND o.created_at < $2
		  AND s.delivery_origin_latitude IS NOT NULL AND s.delivery_origin_longitude IS NOT NULL
		GROUP BY 1,2
		HAVING count(DISTINCT o.id)>=6 AND count(DISTINCT o.store_id)>=3
		ORDER BY count(DISTINCT o.id) DESC, 1,2
		LIMIT 100`, start, end)
	if err != nil {
		return CaptainOpportunityHeatmap{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var latitudeCell, longitudeCell int
		var orderCount int64
		if err := rows.Scan(&latitudeCell, &longitudeCell, &orderCount); err != nil {
			return CaptainOpportunityHeatmap{}, err
		}
		result.Cells = append(result.Cells, CaptainOpportunityCell{
			Latitude:  (float64(latitudeCell) + 0.5) * 0.10,
			Longitude: (float64(longitudeCell) + 0.5) * 0.10,
			Intensity: captainOpportunityIntensity(orderCount),
		})
	}
	if err := rows.Err(); err != nil {
		return CaptainOpportunityHeatmap{}, err
	}
	if len(result.Cells) > 0 {
		result.SampleStatus = "AVAILABLE"
	}
	return result, nil
}
