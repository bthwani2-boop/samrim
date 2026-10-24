package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

// OpsCaseEvent is the bounded audit readback for Operations. The transport
// never exposes event idempotency keys, hashes, or internal correlation IDs.
type OpsCaseEvent struct {
	ID        int64     `json:"id"`
	CaseID    int64     `json:"caseId"`
	Action    string    `json:"action"`
	ActorID   string    `json:"actorId"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
}
type OpsCaseEventPage struct {
	Items      []OpsCaseEvent `json:"items"`
	NextCursor string         `json:"nextCursor"`
}

// Case events are always scoped by BOTH the owning Order and the exact Case.
// An invalid Order/Case pair cannot reveal another Order's timeline.
func ListOrderOpsCaseEvents(ctx context.Context, db *sql.DB, orderID string, caseID int64, limit int, cursor string) (OpsCaseEventPage, error) {
	result := OpsCaseEventPage{Items: []OpsCaseEvent{}}
	orderID = strings.TrimSpace(orderID)
	if db == nil || orderID == "" || len(orderID) > 128 || caseID <= 0 || limit < 1 || limit > 30 {
		return result, ErrOpsCaseInvalid
	}
	before := int64(9223372036854775807)
	if cursor != "" {
		n, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil || n <= 0 {
			return result, ErrOpsCaseInvalid
		}
		before = n
	}
	var checkID int64
	err := db.QueryRowContext(ctx,
		"SELECT id FROM dsh.operator_order_cases WHERE id=$1 AND order_id=$2", caseID, orderID).Scan(&checkID)
	if errors.Is(err, sql.ErrNoRows) {
		return result, ErrOpsCaseNotFound
	}
	if err != nil {
		return result, err
	}
	rows, err := db.QueryContext(ctx, `SELECT e.id,e.case_id,e.action,e.actor_id,e.detail,e.created_at
  FROM dsh.operator_order_case_events e
  JOIN dsh.operator_order_cases c ON c.id=e.case_id
  WHERE c.order_id=$1 AND c.id=$2 AND e.id<$3
  ORDER BY e.id DESC LIMIT $4`, orderID, caseID, before, limit+1)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var event OpsCaseEvent
		if err := rows.Scan(&event.ID, &event.CaseID, &event.Action, &event.ActorID, &event.Detail, &event.CreatedAt); err != nil {
			return result, err
		}
		result.Items = append(result.Items, event)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.NextCursor = strconv.FormatInt(result.Items[limit-1].ID, 10)
	}
	return result, nil
}
