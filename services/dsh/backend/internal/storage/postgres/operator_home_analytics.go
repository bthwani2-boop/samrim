package postgres

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type OperatorHomeDailyOrders struct {
	Day              string `json:"day"`
	Orders           int64  `json:"orders"`
	Delivered        int64  `json:"delivered"`
	AwaitingDispatch int64  `json:"awaitingDispatch"`
	InProgress       int64  `json:"inProgress"`
	Failed           int64  `json:"failed"`
	Cancelled        int64  `json:"cancelled"`
}

type OperatorHomeAnalytics struct {
	Days       []OperatorHomeDailyOrders `json:"days"`
	MeasuredAt time.Time                 `json:"measuredAt"`
	TimeZone   string                    `json:"timeZone"`
}

// A single PostgreSQL snapshot, using Asia/Aden calendar days, counts all
// created orders, including days without orders. Status is current, not an
// inferred historical transition at the end of the respective day.
func ReadOperatorHomeAnalytics(ctx context.Context, db *sql.DB) (OperatorHomeAnalytics, error) {
	return ReadOperatorAnalyticsPeriod(ctx, db, 7)
}

// ReadOperatorAnalyticsPeriod returns a contiguous, locally dated period.
func ReadOperatorAnalyticsPeriod(ctx context.Context, db *sql.DB, days int) (OperatorHomeAnalytics, error) {
	if days != 7 && days != 30 {
		return OperatorHomeAnalytics{}, errors.New("analytics period must be 7 or 30 days")
	}
	if db == nil {
		return OperatorHomeAnalytics{}, errors.New("orders database unavailable")
	}
	rows, err := db.QueryContext(ctx, `
WITH checkpoint AS (
 SELECT statement_timestamp() AS measured_at,
        (statement_timestamp() AT TIME ZONE 'Asia/Aden')::date AS today
), days AS (
 SELECT generate_series((today-($1::integer-1))::timestamp,today::timestamp,interval '1 day')::date AS day
 FROM checkpoint
), grouped AS (
 SELECT (o.created_at AT TIME ZONE 'Asia/Aden')::date AS day,
        count(*) AS orders,
        count(*) FILTER (WHERE o.state='DELIVERED') AS delivered,
        count(*) FILTER (WHERE o.state='READY_FOR_DISPATCH') AS awaiting_dispatch,
        count(*) FILTER (WHERE o.state NOT IN ('DELIVERED','READY_FOR_DISPATCH','DELIVERY_FAILED','CANCELLED','REJECTED')) AS in_progress,
        count(*) FILTER (WHERE o.state='DELIVERY_FAILED') AS failed,
        count(*) FILTER (WHERE o.state IN ('CANCELLED','REJECTED')) AS cancelled
 FROM dsh.commerce_orders o CROSS JOIN checkpoint
 WHERE o.created_at >= ((checkpoint.today-($1::integer-1))::timestamp AT TIME ZONE 'Asia/Aden')
   AND o.created_at <= checkpoint.measured_at
 GROUP BY 1
)
SELECT to_char(days.day,'YYYY-MM-DD'),COALESCE(grouped.orders,0),
       COALESCE(grouped.delivered,0),COALESCE(grouped.awaiting_dispatch,0),
       COALESCE(grouped.in_progress,0),COALESCE(grouped.failed,0),
       COALESCE(grouped.cancelled,0),checkpoint.measured_at
FROM days CROSS JOIN checkpoint LEFT JOIN grouped ON grouped.day=days.day
ORDER BY days.day`, days)
	if err != nil {
		return OperatorHomeAnalytics{}, err
	}
	defer rows.Close()
	result := OperatorHomeAnalytics{Days: make([]OperatorHomeDailyOrders, 0, days), TimeZone: "Asia/Aden"}
	for rows.Next() {
		var day OperatorHomeDailyOrders
		if err := rows.Scan(&day.Day, &day.Orders, &day.Delivered, &day.AwaitingDispatch,
			&day.InProgress, &day.Failed, &day.Cancelled, &result.MeasuredAt); err != nil {
			return OperatorHomeAnalytics{}, err
		}
		result.Days = append(result.Days, day)
	}
	if err := rows.Err(); err != nil {
		return OperatorHomeAnalytics{}, err
	}
	return result, nil
}
