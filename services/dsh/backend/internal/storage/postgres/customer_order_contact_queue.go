package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type PendingCustomerContactItem struct {
	OrderID          string    `json:"orderId"`
	StoreName        string    `json:"storeName"`
	State            string    `json:"state"`
	CreatedAt        time.Time `json:"createdAt"`
	LastContactState string    `json:"lastContactState"`
}
type PendingCustomerContactsPage struct {
	Items      []PendingCustomerContactItem `json:"items"`
	NextCursor string                       `json:"nextCursor"`
}
type pendingContactCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	OrderID   string    `json:"orderId"`
}

func encodePendingContactCursor(item PendingCustomerContactItem) string {
	raw, _ := json.Marshal(pendingContactCursor{CreatedAt: item.CreatedAt, OrderID: item.OrderID})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func decodePendingContactCursor(raw string) (pendingContactCursor, error) {
	var result pendingContactCursor
	if len(raw) > 512 {
		return result, ErrCustomerContactInvalid
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(decoded, &result) != nil || result.OrderID == "" || result.CreatedAt.IsZero() {
		return pendingContactCursor{}, ErrCustomerContactInvalid
	}
	return result, nil
}

// Read-only, keyset-paginated Operations work queue. Each row has a canonical
// unconfirmed Order and belongs to a customer who has not completed the first
// three contact-confirmed deliveries and is not legacy-exempt.
func ListPendingCustomerContacts(ctx context.Context, db *sql.DB, limit int, cursor string) (PendingCustomerContactsPage, error) {
	page := PendingCustomerContactsPage{Items: []PendingCustomerContactItem{}}
	if db == nil || limit < 1 || limit > 50 {
		return page, ErrCustomerContactInvalid
	}
	after := pendingContactCursor{CreatedAt: time.Unix(0, 0).UTC()}
	if strings.TrimSpace(cursor) != "" {
		var err error
		after, err = decodePendingContactCursor(strings.TrimSpace(cursor))
		if err != nil {
			return page, err
		}
	}
	rows, err := db.QueryContext(ctx, `
    SELECT o.id,s.name,o.state,o.created_at,CASE WHEN v.attempt_count>0 THEN v.state ELSE 'PENDING' END
    FROM dsh.commerce_orders o
    JOIN dsh.stores s ON s.id=o.store_id
    LEFT JOIN dsh.customer_order_contact_reviews v ON v.order_id=o.id
    WHERE o.state NOT IN ('DELIVERED','PICKED_UP','REJECTED','CANCELLED')
      AND (v.order_id IS NULL OR v.state<>'CONFIRMED')
      AND (o.created_at,o.id)>($1,$2)
      AND (SELECT count(*) FROM dsh.customer_order_contact_reviews verified
          JOIN dsh.commerce_orders completed ON completed.id=verified.order_id
          WHERE verified.client_actor_id=o.client_actor_id AND verified.state='CONFIRMED'
            AND (
              (completed.fulfillment_mode='CUSTOMER_PICKUP' AND completed.state='PICKED_UP'
               AND EXISTS(SELECT 1 FROM dsh.commerce_order_audit a WHERE a.order_id=completed.id AND a.event_type='order_picked_up'))
              OR
              (completed.fulfillment_mode<>'CUSTOMER_PICKUP' AND completed.state='DELIVERED'
               AND EXISTS(SELECT 1 FROM dsh.captain_audit a WHERE a.order_id=completed.id AND a.event_type='delivery_completed'))
            )
      )<3
      AND (SELECT count(*) FROM dsh.commerce_orders old
          WHERE old.client_actor_id=o.client_actor_id
            AND (
              (old.fulfillment_mode='CUSTOMER_PICKUP' AND old.state='PICKED_UP'
               AND EXISTS(SELECT 1 FROM dsh.commerce_order_audit a WHERE a.order_id=old.id AND a.event_type='order_picked_up'
                 AND a.created_at<(SELECT applied_at FROM dsh.schema_migrations WHERE version=147)))
              OR
              (old.fulfillment_mode<>'CUSTOMER_PICKUP' AND old.state='DELIVERED'
               AND EXISTS(SELECT 1 FROM dsh.captain_audit a WHERE a.order_id=old.id AND a.event_type='delivery_completed'
                 AND a.created_at<(SELECT applied_at FROM dsh.schema_migrations WHERE version=147)))
            )
      )<3
    ORDER BY o.created_at ASC,o.id ASC LIMIT $3`, after.CreatedAt, after.OrderID, limit+1)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var item PendingCustomerContactItem
		if err := rows.Scan(&item.OrderID, &item.StoreName, &item.State, &item.CreatedAt, &item.LastContactState); err != nil {
			return page, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > limit {
		page.NextCursor = encodePendingContactCursor(page.Items[limit-1])
		page.Items = page.Items[:limit]
	}
	return page, nil
}
