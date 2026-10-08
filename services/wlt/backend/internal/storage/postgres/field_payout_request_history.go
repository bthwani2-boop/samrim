package postgres

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type FieldPayoutRequestHistoryEntry struct {
	Status      string
	AmountMinor int64
	Currency    string
	CreatedAt   time.Time
}

type FieldPayoutRequestHistoryPage struct {
	Requests   []FieldPayoutRequestHistoryEntry
	NextCursor string
}

func ListFieldPayoutRequestHistory(ctx context.Context, db *sql.DB, actorID string, cursorAt *time.Time, cursorID string, limit int) (FieldPayoutRequestHistoryPage, error) {
	actorID = strings.TrimSpace(actorID)
	cursorID = strings.TrimSpace(cursorID)
	if db == nil || boundedText(actorID, 1, 128) == "" || (cursorAt != nil && boundedText(cursorID, 1, 128) == "") || (cursorAt == nil && cursorID != "") || limit < 1 || limit > 100 {
		return FieldPayoutRequestHistoryPage{}, ErrPayoutInvalidInput
	}
	rows, err := db.QueryContext(ctx, `SELECT id,status,resolved_amount_minor,currency,created_at
		FROM wlt.payout_requests
		WHERE actor_type='field' AND actor_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3))
		ORDER BY created_at DESC,id DESC LIMIT $4`, actorID, cursorAt, cursorID, limit+1)
	if err != nil {
		return FieldPayoutRequestHistoryPage{}, err
	}
	defer rows.Close()
	page := FieldPayoutRequestHistoryPage{Requests: make([]FieldPayoutRequestHistoryEntry, 0, limit)}
	ids := make([]string, 0, limit+1)
	for rows.Next() {
		var requestID string
		var item FieldPayoutRequestHistoryEntry
		if err := rows.Scan(&requestID, &item.Status, &item.AmountMinor, &item.Currency, &item.CreatedAt); err != nil {
			return FieldPayoutRequestHistoryPage{}, err
		}
		page.Requests = append(page.Requests, item)
		ids = append(ids, requestID)
	}
	if err := rows.Err(); err != nil {
		return FieldPayoutRequestHistoryPage{}, err
	}
	if len(page.Requests) > limit {
		last := page.Requests[limit-1]
		page.NextCursor = last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + ids[limit-1]
		page.Requests = page.Requests[:limit]
	}
	return page, nil
}
