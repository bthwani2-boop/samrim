package postgres

import (
	"context"
	"database/sql"
)

// ListReadyCaptainDispatchOrders pages pending work by stable Order ID.
// Advancing the cursor lets unserviceable old orders coexist with newer ones
// without monopolizing every dispatch cycle.
func ListReadyCaptainDispatchOrders(ctx context.Context, db *sql.DB, limit int, afterID string) ([]string, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	rows, err := db.QueryContext(ctx, `
		SELECT o.id FROM dsh.commerce_orders o
		WHERE o.state='READY_FOR_DISPATCH' AND o.fulfillment_mode='BTHWANI_CAPTAIN'
		  AND o.id>$2
		  AND NOT EXISTS(SELECT 1 FROM dsh.captain_dispatch_offers off
		      WHERE off.order_id=o.id AND off.state='offered' AND off.expires_at>clock_timestamp())
		  AND NOT EXISTS(SELECT 1 FROM dsh.captain_assignments a
		      WHERE a.order_id=o.id AND a.state IN ('assigned','in_custody'))
		ORDER BY o.id LIMIT $1`, limit, afterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	orderIDs := make([]string, 0, limit)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		orderIDs = append(orderIDs, id)
	}
	return orderIDs, rows.Err()
}
