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

type OperatorCustomerOrder struct {
	ID               string    `json:"id"`
	StoreName        string    `json:"storeName"`
	State            string    `json:"state"`
	TotalAmountMinor int64     `json:"totalAmountMinor"`
	Currency         string    `json:"currency"`
	PaymentMethod    string    `json:"paymentMethod"`
	PaymentState     string    `json:"paymentState"`
	CreatedAt        time.Time `json:"createdAt"`
}
type OperatorCustomerDailyActivity struct {
	Day    string `json:"day"`
	Orders int64  `json:"orders"`
}
type OperatorCustomerOrderSummary struct {
	TotalOrders     int64                           `json:"totalOrders"`
	DeliveredOrders int64                           `json:"deliveredOrders"`
	CancelledOrders int64                           `json:"cancelledOrders"`
	RejectedOrders  int64                           `json:"rejectedOrders"`
	FailedOrders    int64                           `json:"failedOrders"`
	OpenOrders      int64                           `json:"openOrders"`
	Last30Days      int64                           `json:"last30Days"`
	Previous30Days  int64                           `json:"previous30Days"`
	DistinctStores  int64                           `json:"distinctStores"`
	FirstOrderAt    *time.Time                      `json:"firstOrderAt"`
	LastOrderAt     *time.Time                      `json:"lastOrderAt"`
	MeasuredAt      time.Time                       `json:"measuredAt"`
	DailyActivity   []OperatorCustomerDailyActivity `json:"dailyActivity"`
}
type OperatorCustomerOrdersPage struct {
	Orders     []OperatorCustomerOrder      `json:"orders"`
	NextCursor string                       `json:"nextCursor"`
	Summary    OperatorCustomerOrderSummary `json:"summary"`
}

var ErrOperatorCustomerOrdersInvalidCursor = errors.New("invalid customer order cursor")

type operatorCustomerOrderCursor struct {
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

// Read-only, actor-scoped keyset pagination. No global order page is filtered in application memory.
func ListOperatorCustomerOrders(ctx context.Context, db *sql.DB, actorID, cursor string, limit int) (OperatorCustomerOrdersPage, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || len(actorID) > 128 || limit < 1 || limit > 50 || len(cursor) > 512 {
		return OperatorCustomerOrdersPage{}, errors.New("invalid operator customer order query")
	}
	where := "o.client_actor_id=$1"
	args := []any{actorID}
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			return OperatorCustomerOrdersPage{}, ErrOperatorCustomerOrdersInvalidCursor
		}
		var last operatorCustomerOrderCursor
		if err := json.Unmarshal(raw, &last); err != nil || last.ActorID != actorID || last.ID == "" || last.CreatedAt.IsZero() {
			return OperatorCustomerOrdersPage{}, ErrOperatorCustomerOrdersInvalidCursor
		}
		where += " AND (o.created_at,o.id)<($2,$3)"
		args = append(args, last.CreatedAt, last.ID)
	}
	args = append(args, limit+1)
	// Stable ordering and the canonical orders table own each financial/order fact.
	query := "SELECT o.id,s.name,o.state,o.total_amount_minor,o.currency,o.payment_method,o.payment_state,o.created_at FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE " + where +
		" ORDER BY o.created_at DESC,o.id DESC LIMIT $" + strconv.Itoa(len(args))
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return OperatorCustomerOrdersPage{}, err
	}
	defer rows.Close()
	page := OperatorCustomerOrdersPage{Orders: make([]OperatorCustomerOrder, 0, limit), NextCursor: ""}
	for rows.Next() {
		var item OperatorCustomerOrder
		if err := rows.Scan(&item.ID, &item.StoreName, &item.State, &item.TotalAmountMinor, &item.Currency, &item.PaymentMethod, &item.PaymentState, &item.CreatedAt); err != nil {
			return OperatorCustomerOrdersPage{}, err
		}
		page.Orders = append(page.Orders, item)
	}
	if err := rows.Err(); err != nil {
		return OperatorCustomerOrdersPage{}, err
	}
	if err := rows.Close(); err != nil {
		return OperatorCustomerOrdersPage{}, err
	}
	if len(page.Orders) > limit {
		last := page.Orders[limit-1]
		raw, _ := json.Marshal(operatorCustomerOrderCursor{ActorID: actorID, CreatedAt: last.CreatedAt, ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
		page.Orders = page.Orders[:limit]
	}
	// Statistics cover every order for this actor; never infer lifetime performance from a single page.
	page.Summary, err = readOperatorCustomerOrderSummary(ctx, db, actorID)
	if err != nil {
		return OperatorCustomerOrdersPage{}, err
	}
	return page, nil
}

func readOperatorCustomerOrderSummary(ctx context.Context, db *sql.DB, actorID string) (OperatorCustomerOrderSummary, error) {
	var result OperatorCustomerOrderSummary
	var first, last sql.NullTime
	err := db.QueryRowContext(ctx, `
WITH checkpoint AS (SELECT statement_timestamp() AS measured_at)
SELECT count(o.id),
	count(*) FILTER (WHERE o.state='DELIVERED'),
	count(*) FILTER (WHERE o.state='CANCELLED'),
	count(*) FILTER (WHERE o.state='REJECTED'),
	count(*) FILTER (WHERE o.state='DELIVERY_FAILED'),
	count(*) FILTER (WHERE o.state NOT IN ('DELIVERED','CANCELLED','REJECTED','DELIVERY_FAILED')),
	count(*) FILTER (WHERE o.created_at>=checkpoint.measured_at-interval '30 days'),
	count(*) FILTER (WHERE o.created_at>=checkpoint.measured_at-interval '60 days' AND o.created_at<checkpoint.measured_at-interval '30 days'),
	count(DISTINCT o.store_id),
	min(o.created_at),max(o.created_at),checkpoint.measured_at
FROM checkpoint LEFT JOIN dsh.commerce_orders o ON o.client_actor_id=$1
GROUP BY checkpoint.measured_at`, actorID).Scan(
		&result.TotalOrders, &result.DeliveredOrders, &result.CancelledOrders, &result.RejectedOrders,
		&result.FailedOrders, &result.OpenOrders, &result.Last30Days, &result.Previous30Days,
		&result.DistinctStores, &first, &last, &result.MeasuredAt)
	if err != nil {
		return OperatorCustomerOrderSummary{}, err
	}
	if first.Valid {
		at := first.Time
		result.FirstOrderAt = &at
	}
	if last.Valid {
		at := last.Time
		result.LastOrderAt = &at
	}
	result.DailyActivity = make([]OperatorCustomerDailyActivity, 0, 7)
	rows, err := db.QueryContext(ctx, `
WITH days AS (
 SELECT generate_series(((statement_timestamp() AT TIME ZONE 'Asia/Aden')::date-6)::timestamp,
                        ((statement_timestamp() AT TIME ZONE 'Asia/Aden')::date)::timestamp,
                        interval '1 day') AS day
), counts AS (
 SELECT (created_at AT TIME ZONE 'Asia/Aden')::date AS day, count(*) AS orders
 FROM dsh.commerce_orders
 WHERE client_actor_id=$1 AND created_at >= (((statement_timestamp() AT TIME ZONE 'Asia/Aden')::date-6)::timestamp AT TIME ZONE 'Asia/Aden')
 GROUP BY 1
)
SELECT to_char(days.day,'YYYY-MM-DD'),COALESCE(counts.orders,0)
FROM days LEFT JOIN counts ON counts.day=days.day::date ORDER BY days.day`, actorID)
	if err != nil {
		return OperatorCustomerOrderSummary{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item OperatorCustomerDailyActivity
		if err := rows.Scan(&item.Day, &item.Orders); err != nil {
			return OperatorCustomerOrderSummary{}, err
		}
		result.DailyActivity = append(result.DailyActivity, item)
	}
	if err := rows.Err(); err != nil {
		return OperatorCustomerOrderSummary{}, err
	}
	return result, nil
}
