package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrClientOrdersInvalidCursor = errors.New("client orders cursor is invalid")
var ErrClientOrdersInvalidFilters = errors.New("client orders filters are invalid")

type ClientOrdersFilters struct {
	Search          string
	Status          string
	FulfillmentMode string
}

type ClientOrdersPage struct {
	Orders     []OrderRecord
	NextCursor string
}

type clientOrdersCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
	ActorID   string    `json:"actorId"`
	FilterKey string    `json:"filterKey,omitempty"`
}

func encodeClientOrdersCursor(value clientOrdersCursor) string {
	raw, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeClientOrdersCursor(raw, actorID, filterKey string) (clientOrdersCursor, error) {
	var value clientOrdersCursor
	if len(raw) > 4096 || strings.TrimSpace(raw) == "" {
		return value, ErrClientOrdersInvalidCursor
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(data, &value) != nil || value.CreatedAt.IsZero() || value.ID == "" || value.ActorID != actorID || value.FilterKey != filterKey {
		return clientOrdersCursor{}, ErrClientOrdersInvalidCursor
	}
	return value, nil
}

const clientOrderHistoryPageSQL = "SELECT " + orderSelectColumnsWithStore + `
	FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id
	WHERE o.client_actor_id=$1
		AND CASE $2::text
			WHEN 'active' THEN o.state NOT IN ('DELIVERED','PICKED_UP','CANCELLED','REJECTED','DELIVERY_FAILED')
			WHEN 'completed' THEN o.state IN ('DELIVERED','PICKED_UP')
			WHEN 'cancelled' THEN o.state IN ('CANCELLED','REJECTED','DELIVERY_FAILED')
			ELSE true
		END
		AND ($3::text='' OR o.fulfillment_mode=$3)
		AND ($4::text='' OR strpos(lower(o.id),lower($4))>0 OR strpos(lower(s.name),lower($4))>0)
		AND ($5::timestamptz IS NULL OR (o.created_at,o.id)<($5,$6::text))
	ORDER BY o.created_at DESC,o.id DESC LIMIT $7`

// ListOrdersForClientPage performs a stable keyset read within the authenticated
// client's canonical Order scope and binds the cursor to the history filters.
func ListOrdersForClientPage(ctx context.Context, db *sql.DB, actorID string, limit int, cursor string, filters ClientOrdersFilters) (ClientOrdersPage, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || limit < 1 || limit > 100 {
		return ClientOrdersPage{}, ErrClientOrdersInvalidCursor
	}
	filters.Search = strings.TrimSpace(filters.Search)
	if !utf8.ValidString(filters.Search) || utf8.RuneCountInString(filters.Search) > 128 || strings.ContainsRune(filters.Search, 0) {
		return ClientOrdersPage{}, ErrClientOrdersInvalidFilters
	}
	switch filters.Status {
	case "", "active", "completed", "cancelled":
	default:
		return ClientOrdersPage{}, ErrClientOrdersInvalidFilters
	}
	switch filters.FulfillmentMode {
	case "", FulfillmentModeBthwaniCaptain, FulfillmentModePartnerCaptain, FulfillmentModeCustomerPickup:
	default:
		return ClientOrdersPage{}, ErrClientOrdersInvalidFilters
	}
	var filterKey string
	if filters != (ClientOrdersFilters{}) {
		hash := sha256.Sum256([]byte(strings.Join([]string{filters.Status, filters.FulfillmentMode, filters.Search}, "\x00")))
		filterKey = base64.RawURLEncoding.EncodeToString(hash[:])
	}
	var beforeCreatedAt any
	var beforeID string
	if cursor != "" {
		decoded, err := decodeClientOrdersCursor(cursor, actorID, filterKey)
		if err != nil {
			return ClientOrdersPage{}, err
		}
		beforeCreatedAt, beforeID = decoded.CreatedAt, decoded.ID
	}
	rows, err := db.QueryContext(ctx, clientOrderHistoryPageSQL, actorID, filters.Status, filters.FulfillmentMode, filters.Search, beforeCreatedAt, beforeID, limit+1)
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
		result.NextCursor = encodeClientOrdersCursor(clientOrdersCursor{CreatedAt: last.CreatedAt, ID: last.ID, ActorID: actorID, FilterKey: filterKey})
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
