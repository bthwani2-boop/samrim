package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var ErrNotificationNotFound = errors.New("notification was not found")

type NotificationEvent struct {
	ID        string
	EventType string
	OrderID   string
	ToState   string
	CreatedAt time.Time
	ReadAt    *time.Time
}

type NotificationListResult struct {
	Items       []NotificationEvent
	UnreadCount int
}

func ListNotifications(ctx context.Context, db *sql.DB, actorID, role string, limit int) (NotificationListResult, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || limit < 1 || limit > 100 {
		return NotificationListResult{}, errors.New("notification query input is invalid")
	}
	events := visibleNotificationEvents(role)
	if events == "" {
		return NotificationListResult{}, errors.New("notification role is invalid")
	}
	rows, err := db.QueryContext(ctx, `WITH visible_events AS (`+events+`)
		SELECT visible_events.notification_id, visible_events.event_type, visible_events.order_id,
		       visible_events.to_state, visible_events.created_at, read_state.read_at
		FROM visible_events
		LEFT JOIN dsh.notification_read_state read_state
		  ON read_state.actor_id = $1 AND read_state.notification_id = visible_events.notification_id
		ORDER BY visible_events.created_at DESC, visible_events.notification_id DESC
		LIMIT $2`, actorID, limit)
	if err != nil {
		return NotificationListResult{}, fmt.Errorf("list DSH notifications: %w", err)
	}
	defer rows.Close()
	items := make([]NotificationEvent, 0, limit)
	for rows.Next() {
		var item NotificationEvent
		var readAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.EventType, &item.OrderID, &item.ToState, &item.CreatedAt, &readAt); err != nil {
			return NotificationListResult{}, fmt.Errorf("scan DSH notification: %w", err)
		}
		if readAt.Valid {
			item.ReadAt = &readAt.Time
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NotificationListResult{}, fmt.Errorf("iterate DSH notifications: %w", err)
	}

	var unread int
	if err := db.QueryRowContext(ctx, `WITH visible_events AS (`+events+`)
		SELECT COUNT(*)
		FROM visible_events
		LEFT JOIN dsh.notification_read_state read_state
		  ON read_state.actor_id = $1 AND read_state.notification_id = visible_events.notification_id
		WHERE read_state.read_at IS NULL`, actorID).Scan(&unread); err != nil {
		return NotificationListResult{}, fmt.Errorf("count unread DSH notifications: %w", err)
	}
	return NotificationListResult{Items: items, UnreadCount: unread}, nil
}

func MarkNotificationRead(ctx context.Context, db *sql.DB, actorID, role, notificationID string) (time.Time, error) {
	actorID = strings.TrimSpace(actorID)
	notificationID = strings.TrimSpace(notificationID)
	if db == nil || actorID == "" {
		return time.Time{}, errors.New("notification read input is invalid")
	}
	if !validNotificationID(notificationID) || visibleNotificationEvents(role) == "" {
		return time.Time{}, ErrNotificationNotFound
	}
	events := visibleNotificationEvents(role)
	var exists bool
	if err := db.QueryRowContext(ctx, `WITH visible_events AS (`+events+`)
		SELECT EXISTS (SELECT 1 FROM visible_events WHERE notification_id = $2)`, actorID, notificationID).Scan(&exists); err != nil {
		return time.Time{}, fmt.Errorf("check DSH notification visibility: %w", err)
	}
	if !exists {
		return time.Time{}, ErrNotificationNotFound
	}
	var readAt time.Time
	if err := db.QueryRowContext(ctx, `INSERT INTO dsh.notification_read_state(actor_id, notification_id, read_at)
		VALUES ($1, $2, clock_timestamp())
		ON CONFLICT (actor_id, notification_id) DO UPDATE SET read_at = EXCLUDED.read_at
		RETURNING read_at`, actorID, notificationID).Scan(&readAt); err != nil {
		return time.Time{}, fmt.Errorf("mark DSH notification read: %w", err)
	}
	return readAt, nil
}

func validNotificationID(notificationID string) bool {
	parts := strings.SplitN(notificationID, ":", 2)
	if len(parts) != 2 || (parts[0] != "order" && parts[0] != "captain") {
		return false
	}
	value, err := strconv.ParseInt(parts[1], 10, 64)
	return err == nil && value > 0
}

func visibleNotificationEvents(role string) string {
	const clientOrPartner = `
		SELECT 'order:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       audit.to_state, audit.created_at
		FROM dsh.commerce_order_audit audit
		JOIN dsh.commerce_orders orders ON orders.id = audit.order_id
		%s
		UNION ALL
		SELECT 'captain:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       audit.to_state, audit.created_at
		FROM dsh.captain_audit audit
		JOIN dsh.commerce_orders orders ON orders.id = audit.order_id
		%s
		  AND audit.event_type NOT IN ('dispatch_offer_created', 'dispatch_offer_rejected', 'dispatch_offer_expired', 'captain_offer_superseded_by_access')`
	const captain = `
		SELECT 'captain:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       audit.to_state, audit.created_at
		FROM dsh.captain_audit audit
		WHERE audit.captain_actor_id = $1
		  AND audit.order_id IS NOT NULL`
	switch role {
	case "client":
		return fmt.Sprintf(clientOrPartner, "WHERE orders.client_actor_id = $1", "WHERE orders.client_actor_id = $1")
	case "partner":
		return fmt.Sprintf(clientOrPartner, "JOIN dsh.stores stores ON stores.id = orders.store_id WHERE stores.partner_actor_id = $1", "JOIN dsh.stores stores ON stores.id = orders.store_id WHERE stores.partner_actor_id = $1")
	case "captain":
		return captain
	default:
		return ""
	}
}
