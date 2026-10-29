package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func enqueueStoreGoLiveNotificationsTx(ctx context.Context, tx *sql.Tx, storeID string) error {
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return fmt.Errorf("store go-live notification store is required")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO dsh.store_go_live_notifications(actor_id,actor_role,store_id,event_type)
		SELECT partner_actor_id,'partner',id,'store_published_handoff'
		FROM dsh.stores
		WHERE id=$1 AND publication_state='published'
		ON CONFLICT (store_id,actor_id,actor_role,event_type) DO NOTHING`, storeID); err != nil {
		return fmt.Errorf("enqueue Partner store publication notification: %w", err)
	}

	return nil
}
