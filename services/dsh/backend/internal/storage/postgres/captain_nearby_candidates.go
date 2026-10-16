package postgres

import (
	"context"
	"database/sql"
	"strings"
)

type NearbyCaptainCandidate struct {
	ActorID string
}

// ListNearbyCaptainCandidates uses the canonical latest presence only.
// Captains without a fresh position are not eligible for distance-based dispatch.
func ListNearbyCaptainCandidates(ctx context.Context, db *sql.DB, orderID, excludedActorID string) ([]NearbyCaptainCandidate, int64, error) {
	var cashMinor int64
	err := db.QueryRowContext(ctx, `SELECT payment_cash_amount_minor FROM dsh.commerce_orders WHERE id=$1`, orderID).Scan(&cashMinor)
	if err != nil {
		return nil, 0, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT a.actor_id
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
		ORDER BY
			power((p.latitude-s.delivery_origin_latitude)*111195.0,2)
			+power((p.longitude-s.delivery_origin_longitude)*111195.0*cos(radians(s.delivery_origin_latitude)),2),
			a.actor_id
		LIMIT 30`, orderID, strings.TrimSpace(excludedActorID))
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	result := make([]NearbyCaptainCandidate, 0, 3)
	for rows.Next() {
		var item NearbyCaptainCandidate
		if err := rows.Scan(&item.ActorID); err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	return result, cashMinor, rows.Err()
}
