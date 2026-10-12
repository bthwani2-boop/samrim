package hr

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type EmployeeEvent struct {
	EventType     string    `json:"eventType"`
	ActingActorID string    `json:"actingActorId"`
	Reason        string    `json:"reason,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}
type EmployeeEventsPage struct {
	Items      []EmployeeEvent `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
}
type eventCursor struct {
	Time time.Time `json:"t"`
	Key  string    `json:"k"`
}

func ListEmployeeEvents(ctx context.Context, db *sql.DB, id, encoded string, limit int) (EmployeeEventsPage, error) {
	if db == nil || !strings.HasPrefix(id, "emp_") || len(id) != 36 || len(encoded) > 1024 || limit < 1 || limit > 50 {
		return EmployeeEventsPage{}, ErrInvalid
	}
	if _, err := Read(ctx, db, id); err != nil {
		return EmployeeEventsPage{}, err
	}
	var since any
	var lastKey string
	if encoded != "" {
		bytes, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil {
			return EmployeeEventsPage{}, ErrInvalid
		}
		var cursor eventCursor
		if json.Unmarshal(bytes, &cursor) != nil || cursor.Time.IsZero() || cursor.Key == "" {
			return EmployeeEventsPage{}, ErrInvalid
		}
		since = cursor.Time
		lastKey = cursor.Key
	}
	rows, err := db.QueryContext(ctx, `SELECT event_type,acting_actor_id,COALESCE(reason,''),created_at,idempotency_key
 FROM dsh.hr_employee_events
 WHERE employee_id=$1 AND ($2::timestamptz IS NULL OR (created_at,idempotency_key)<($2::timestamptz,$3))
 ORDER BY created_at DESC,idempotency_key DESC LIMIT $4`, id, since, lastKey, limit+1)
	if err != nil {
		return EmployeeEventsPage{}, err
	}
	defer rows.Close()
	type record struct {
		event EmployeeEvent
		key   string
	}
	all := make([]record, 0, limit+1)
	for rows.Next() {
		var item record
		if err = rows.Scan(&item.event.EventType, &item.event.ActingActorID, &item.event.Reason, &item.event.CreatedAt, &item.key); err != nil {
			return EmployeeEventsPage{}, err
		}
		all = append(all, item)
	}
	if err = rows.Err(); err != nil {
		return EmployeeEventsPage{}, err
	}
	hasNext := len(all) > limit
	if hasNext {
		all = all[:limit]
	}
	result := EmployeeEventsPage{Items: make([]EmployeeEvent, 0, len(all))}
	for _, row := range all {
		result.Items = append(result.Items, row.event)
	}
	if hasNext {
		final := all[len(all)-1]
		raw, e := json.Marshal(eventCursor{Time: final.event.CreatedAt, Key: final.key})
		if e != nil {
			return EmployeeEventsPage{}, e
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return result, nil
}
