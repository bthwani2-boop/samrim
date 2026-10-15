package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

var ErrClientOrdersInvalidCursor = errors.New("client orders cursor is invalid")

type ClientOrdersPage struct {
	Orders     []OrderRecord
	NextCursor string
}

type clientOrdersCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
	ActorID   string    `json:"actorId"`
}

func encodeClientOrdersCursor(value clientOrdersCursor) string {
	raw, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeClientOrdersCursor(raw, actorID string) (clientOrdersCursor, error) {
	var value clientOrdersCursor
	if len(raw) > 4096 || strings.TrimSpace(raw) == "" {
		return value, ErrClientOrdersInvalidCursor
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(data, &value) != nil || value.CreatedAt.IsZero() || value.ID == "" || value.ActorID != actorID {
		return clientOrdersCursor{}, ErrClientOrdersInvalidCursor
	}
	return value, nil
}

// ListOrdersForClientPage performs a stable keyset read within the authenticated
// client's canonical Order scope. The cursor cannot change the actor scope.
func ListOrdersForClientPage(ctx context.Context, db *sql.DB, actorID string, limit int, cursor string) (ClientOrdersPage, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || limit < 1 || limit > 100 {
		return ClientOrdersPage{}, ErrClientOrdersInvalidCursor
	}
	where := "o.client_actor_id=$1"
	args := []any{actorID}
	if cursor != "" {
		decoded, err := decodeClientOrdersCursor(cursor, actorID)
		if err != nil {
			return ClientOrdersPage{}, err
		}
		args = append(args, decoded.CreatedAt, decoded.ID)
		where += " AND (o.created_at,o.id) < ($2,$3)"
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE "+where+" ORDER BY o.created_at DESC,o.id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return ClientOrdersPage{}, err
	}
	items := make([]OrderRecord, 0, limit+1)
	for rows.Next() {
		item, scanErr := scanOrderWithStore(rows)
		if scanErr != nil {
			_ = rows.Close()
			return ClientOrdersPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return ClientOrdersPage{}, err
	}
	if err := rows.Close(); err != nil {
		return ClientOrdersPage{}, err
	}
	result := ClientOrdersPage{Orders: items}
	if len(items) > limit {
		last := items[limit-1]
		result.Orders = items[:limit]
		result.NextCursor = encodeClientOrdersCursor(clientOrdersCursor{CreatedAt: last.CreatedAt, ID: last.ID, ActorID: actorID})
	}
	for index := range result.Orders {
		result.Orders[index].Lines, err = listOrderLines(ctx, db, result.Orders[index].ID)
		if err != nil {
			return ClientOrdersPage{}, err
		}
		result.Orders[index].Adjustments, err = listOrderAdjustments(ctx, db, result.Orders[index].ID)
		if err != nil {
			return ClientOrdersPage{}, err
		}
	}
	return result, nil
}
