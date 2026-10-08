package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var ErrNotificationNotFound = errors.New("notification was not found")

type NotificationEvent struct {
	ID            string
	EventType     string
	OrderID       string
	JoiningCaseID string
	StoreID       string
	ToState       string
	CreatedAt     time.Time
	ReadAt        *time.Time
}

type NotificationListResult struct {
	Items       []NotificationEvent
	UnreadCount int
	NextCursor  string
}

type notificationCursor struct {
	Version   int       `json:"v"`
	ActorID   string    `json:"a"`
	Role      string    `json:"r"`
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"i"`
}

var ErrNotificationInvalidCursor = errors.New("notification cursor is invalid")

const markNotificationReadSQL = `INSERT INTO dsh.notification_read_state AS existing(actor_id, notification_id, read_at)
		VALUES ($1, $2, clock_timestamp())
		ON CONFLICT (actor_id, notification_id) DO UPDATE SET read_at = existing.read_at
		RETURNING read_at`

func encodeNotificationCursor(cursor notificationCursor) string {
	value, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(value)
}

func decodeNotificationCursor(raw, actorID, role string) (*notificationCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 1024 {
		return nil, ErrNotificationInvalidCursor
	}
	value, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(value) > 1024 {
		return nil, ErrNotificationInvalidCursor
	}
	var cursor notificationCursor
	if json.Unmarshal(value, &cursor) != nil || cursor.Version != 1 || cursor.ActorID != actorID || cursor.Role != role || cursor.CreatedAt.IsZero() || !validNotificationID(cursor.ID) {
		return nil, ErrNotificationInvalidCursor
	}
	return &cursor, nil
}

func ListNotifications(ctx context.Context, db *sql.DB, actorID, role string, limit int, rawCursor string) (NotificationListResult, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || limit < 1 || limit > 100 {
		return NotificationListResult{}, errors.New("notification query input is invalid")
	}
	events := visibleNotificationEvents(role)
	if events == "" {
		return NotificationListResult{}, errors.New("notification role is invalid")
	}
	cursor, err := decodeNotificationCursor(rawCursor, actorID, role)
	if err != nil {
		return NotificationListResult{}, err
	}
	var cursorCreatedAt any
	var cursorID string
	if cursor != nil {
		cursorCreatedAt, cursorID = cursor.CreatedAt, cursor.ID
	}
	rows, err := db.QueryContext(ctx, `WITH visible_events AS (`+events+`)
		SELECT visible_events.notification_id, visible_events.event_type, visible_events.order_id,
		       visible_events.joining_case_id, visible_events.store_id, visible_events.to_state, visible_events.created_at, read_state.read_at
		FROM visible_events
		LEFT JOIN dsh.notification_read_state read_state
		  ON read_state.actor_id = $1 AND read_state.notification_id = visible_events.notification_id
		WHERE ($2::timestamptz IS NULL OR (visible_events.created_at, visible_events.notification_id) < ($2, $3))
		ORDER BY visible_events.created_at DESC, visible_events.notification_id DESC
		LIMIT $4`, actorID, cursorCreatedAt, cursorID, limit+1)
	if err != nil {
		return NotificationListResult{}, fmt.Errorf("list DSH notifications: %w", err)
	}
	defer rows.Close()
	items := make([]NotificationEvent, 0, limit+1)
	for rows.Next() {
		var item NotificationEvent
		var readAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.EventType, &item.OrderID, &item.JoiningCaseID, &item.StoreID, &item.ToState, &item.CreatedAt, &readAt); err != nil {
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

	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeNotificationCursor(notificationCursor{Version: 1, ActorID: actorID, Role: role, CreatedAt: last.CreatedAt.UTC(), ID: last.ID})
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
	return NotificationListResult{Items: items, UnreadCount: unread, NextCursor: nextCursor}, nil
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
	if err := db.QueryRowContext(ctx, markNotificationReadSQL, actorID, notificationID).Scan(&readAt); err != nil {
		return time.Time{}, fmt.Errorf("mark DSH notification read: %w", err)
	}
	return readAt, nil
}

func validNotificationID(notificationID string) bool {
	parts := strings.SplitN(notificationID, ":", 2)
	if len(parts) != 2 || (parts[0] != "order" && parts[0] != "captain" && parts[0] != "field" && parts[0] != "store") {
		return false
	}
	value, err := strconv.ParseInt(parts[1], 10, 64)
	return err == nil && value > 0
}

func visibleNotificationEvents(role string) string {
	const clientOrPartner = `
		SELECT 'order:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       ''::text AS joining_case_id, ''::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.commerce_order_audit audit
		JOIN dsh.commerce_orders orders ON orders.id = audit.order_id
		%s
		UNION ALL
		SELECT 'captain:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       ''::text AS joining_case_id, ''::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.captain_audit audit
		JOIN dsh.commerce_orders orders ON orders.id = audit.order_id
		%s
		  AND audit.event_type NOT IN ('dispatch_offer_created', 'dispatch_offer_rejected', 'dispatch_offer_expired', 'captain_offer_superseded_by_access')`
	const captain = `
		SELECT 'captain:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       ''::text AS joining_case_id, ''::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.captain_audit audit
		WHERE audit.captain_actor_id = $1
		  AND audit.order_id IS NOT NULL`
	const field = `
		SELECT 'field:' || audit.id::text AS notification_id, audit.event_type, ''::text AS order_id,
		       audit.case_id::text AS joining_case_id, COALESCE(cases.store_id, '')::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.joining_case_audit audit
		JOIN dsh.joining_cases cases ON cases.id = audit.case_id
		WHERE cases.originating_field_actor_id = $1`
	const operator = `
		SELECT 'order:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       ''::text AS joining_case_id, ''::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.commerce_order_audit audit
		WHERE audit.order_id IS NOT NULL
		UNION ALL
		SELECT 'captain:' || audit.id::text AS notification_id, audit.event_type, audit.order_id,
		       ''::text AS joining_case_id, ''::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.captain_audit audit
		WHERE audit.order_id IS NOT NULL
		UNION ALL
		SELECT 'field:' || audit.id::text AS notification_id, audit.event_type, ''::text AS order_id,
		       audit.case_id::text AS joining_case_id, COALESCE(cases.store_id, '')::text AS store_id, audit.to_state, audit.created_at
		FROM dsh.joining_case_audit audit
		JOIN dsh.joining_cases cases ON cases.id = audit.case_id
		WHERE audit.case_id IS NOT NULL`
	const storeGoLive = `
		SELECT 'store:' || notification.id::text AS notification_id, notification.event_type, ''::text AS order_id,
		       COALESCE(cases.id, '')::text AS joining_case_id, notification.store_id, 'published'::text AS to_state, notification.created_at
		FROM dsh.store_go_live_notifications notification
		LEFT JOIN LATERAL (
			SELECT joining_case.id
			FROM dsh.joining_cases joining_case
			WHERE joining_case.store_id=notification.store_id AND joining_case.origin='field' AND joining_case.originating_field_actor_id=notification.actor_id
			ORDER BY joining_case.id
			LIMIT 1
		) cases ON TRUE
		WHERE notification.actor_id=$1 AND notification.actor_role=`
	switch role {
	case "client":
		return fmt.Sprintf(clientOrPartner, "WHERE orders.client_actor_id = $1", "WHERE orders.client_actor_id = $1")
	case "partner":
		return fmt.Sprintf(clientOrPartner, "JOIN dsh.stores stores ON stores.id = orders.store_id WHERE stores.partner_actor_id = $1", "JOIN dsh.stores stores ON stores.id = orders.store_id WHERE stores.partner_actor_id = $1") + ` UNION ALL ` + storeGoLive + `'partner'`
	case "captain":
		return captain
	case "field":
		return field + ` UNION ALL ` + storeGoLive + `'field'`
	case "operator":
		return operator
	default:
		return ""
	}
}
