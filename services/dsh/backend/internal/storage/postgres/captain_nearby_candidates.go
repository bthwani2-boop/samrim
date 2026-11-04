package postgres

import (
	"context"
	"database/sql"
	"strings"
)

const NearbyCaptainCandidatePageSize = 30

type NearbyCaptainCandidate struct {
	ActorID         string
	DistanceSquared float64
}

// ListNearbyCaptainCandidates uses canonical fresh presence and a distance/ID
// cursor. A page is bounded, but DSH can continue beyond the first 30 nearby
// Captains until enough WLT-funded Captains have been found.
func ListNearbyCaptainCandidates(ctx context.Context, db *sql.DB, orderID, excludedActorID string, after *NearbyCaptainCandidate) ([]NearbyCaptainCandidate, int64, error) {
	var cashMinor int64
	err := db.QueryRowContext(ctx, `SELECT payment_cash_amount_minor FROM dsh.commerce_orders WHERE id=$1`, orderID).Scan(&cashMinor)
	if err != nil {
		return nil, 0, err
	}
	var afterDistance any
	afterActorID := ""
	if after != nil {
		afterDistance = after.DistanceSquared
		afterActorID = after.ActorID
	}
	rows, err := db.QueryContext(ctx, `
		WITH ranked AS (
			SELECT a.actor_id,
				power((p.latitude-s.delivery_origin_latitude)*111195.0,2)
				+power((p.longitude-s.delivery_origin_longitude)*111195.0*cos(radians(s.delivery_origin_latitude)),2) AS distance_squared
			FROM dsh.commerce_orders o
			JOIN dsh.stores s ON s.id=o.store_id
			JOIN dsh.captain_admissions a ON a.state='eligible'
				AND a.availability_state='available' AND a.requires_profile_review=false
			JOIN dsh.captain_presence_latest p ON p.captain_actor_id=a.actor_id
			WHERE o.id=$1
				AND s.delivery_origin_latitude IS NOT NULL
				AND s.delivery_origin_longitude IS NOT NULL
				AND p.updated_at > clock_timestamp()-interval '15 minutes'
				AND a.actor_id<>$2
				AND NOT EXISTS(SELECT 1 FROM dsh.captain_dispatch_offers off
					WHERE off.captain_actor_id=a.actor_id AND off.state='offered')
				AND NOT EXISTS(SELECT 1 FROM dsh.captain_assignments ca
					WHERE ca.captain_actor_id=a.actor_id AND ca.state IN ('assigned','in_custody'))
		)
		SELECT actor_id,distance_squared FROM ranked
		WHERE ($3::double precision IS NULL OR (distance_squared,actor_id) > ($3::double precision,$4))
		ORDER BY distance_squared,actor_id
		LIMIT $5`, orderID, strings.TrimSpace(excludedActorID), afterDistance, afterActorID, NearbyCaptainCandidatePageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	result := make([]NearbyCaptainCandidate, 0, NearbyCaptainCandidatePageSize)
	for rows.Next() {
		var item NearbyCaptainCandidate
		if err := rows.Scan(&item.ActorID, &item.DistanceSquared); err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	return result, cashMinor, rows.Err()
}
