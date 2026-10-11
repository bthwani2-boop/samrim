package postgres

import (
	"context"
	"database/sql"
	"time"

	"github.com/lib/pq"
)

// Public discovery evaluates one consistent instant for the whole page.
// Fetch Store schedules once rather than issuing a request per card or mode.
func EvaluatePublishedStoresOrderability(ctx context.Context, db *sql.DB, stores []PublicStoreRecord, at time.Time) (map[string][]StoreOrderability, error) {
	result := make(map[string][]StoreOrderability, len(stores))
	if len(stores) == 0 {
		return result, nil
	}
	ids := make([]string, 0, len(stores))
	for _, store := range stores {
		ids = append(ids, store.ID)
	}
	rows, err := db.QueryContext(ctx, `SELECT store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,pause_reason,pause_until,preparation_minutes,unavailable_fulfillment_modes,version,updated_by_actor_id,updated_at
  FROM dsh.store_operational_availability WHERE store_id = ANY($1)`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	available := make(map[string]StoreOperationalAvailability, len(stores))
	for rows.Next() {
		item, readErr := readStoreOperationalAvailabilityRow(ctx, rows)
		if readErr != nil {
			rows.Close()
			return nil, readErr
		}
		available[item.StoreID] = item
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	for _, store := range stores {
		availability, ok := available[store.ID]
		if !ok {
			// Legacy published Stores may predate the availability row.
			// Follow the same canonical initialization as checkout and Store details.
			availability, err = ReadStoreOperationalAvailability(ctx, db, store.ID)
			if err != nil {
				return nil, err
			}
		}
		evaluated := make([]StoreOrderability, 0, len(store.FulfillmentModes))
		for _, mode := range store.FulfillmentModes {
			item, evaluateErr := evaluateStoreOrderability(availability, mode, at)
			if evaluateErr != nil {
				return nil, evaluateErr
			}
			evaluated = append(evaluated, item)
		}
		result[store.ID] = evaluated
	}
	return result, nil
}
