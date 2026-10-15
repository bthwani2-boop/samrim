package postgres

import (
	"context"
	"database/sql"
)

// ListReadyCaptainDispatchOrders is the bounded, source-owned recovery scan
// for orders awaiting an automatic dispatch batch.
func ListReadyCaptainDispatchOrders(ctx context.Context, db *sql.DB, limit int) ([]string, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	rows, err := db.QueryContext(ctx, `
		SELECT o.id FROM dsh.commerce_orders o
		WHERE o.state='READY_FOR_DISPATCH' AND o.fulfillment_mode='BTHWANI_CAPTAIN'
		  AND NOT EXISTS(SELECT 1 FROM dsh.captain_dispatch_offers off
		      WHERE off.order_id=o.id AND off.state='offered' AND off.expires_at>clock_timestamp())
		  AND NOT EXISTS(SELECT 1 FROM dsh.captain_assignments a
		      WHERE a.order_id=o.id AND a.state IN ('assigned','in_custody'))
		ORDER BY o.created_at,o.id LIMIT $1`, limit)
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
