package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrIndependentPartnerOrderInvalid  = errors.New("invalid independent order operation")
	ErrIndependentPartnerOrderConflict = errors.New("independent order state or version changed")
)

type IndependentPartnerOrderLine struct {
	OfferID           string `json:"offerId"`
	ProductName       string `json:"productName"`
	VariantTitle      string `json:"variantTitle"`
	QuantityBaseUnits int64  `json:"quantityBaseUnits"`
	LineAmountMinor   int64  `json:"lineAmountMinor"`
}

type IndependentPartnerOrder struct {
	IndependentDirectOrderStatus
	TotalMinor int64                         `json:"totalMinor"`
	CreatedAt  time.Time                     `json:"createdAt"`
	Lines      []IndependentPartnerOrderLine `json:"lines"`
}

type IndependentPartnerOrderPage struct {
	Orders     []IndependentPartnerOrder `json:"orders"`
	NextCursor string                    `json:"nextCursor"`
}

type IndependentPartnerOrderTransition struct {
	State           string `json:"state"`
	ExpectedVersion int    `json:"expectedVersion"`
	Reason          string `json:"reason,omitempty"`
}

type independentOrderCursor struct {
	StoreID string    `json:"storeId"`
	OrderID string    `json:"orderId"`
	At      time.Time `json:"at"`
}

func validIndependentPartnerOrderID(value string) bool {
	return value != "" && len(value) <= 128 && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n")
}

// Take share locks on authorization rows for writes so revocation or a Store
// ownership change cannot commit during an already-authorized transition.
func authorizeIndependentPartnerOrders(ctx context.Context, tx *sql.Tx, storeID, actorID, permission string, lock bool) error {
	var ownerID string
	query := `SELECT partner_actor_id FROM dsh.stores s WHERE s.id=$1 AND s.deleted_at IS NULL
		AND (s.relation_model='INDEPENDENT_STORE' OR EXISTS
			(SELECT 1 FROM dsh.independent_direct_orders d WHERE d.store_id=s.id))`
	if lock {
		query += " FOR SHARE OF s"
	}
	if err := tx.QueryRowContext(ctx, query, storeID).Scan(&ownerID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrOrderNotFound
		}
		return err
	}
	if ownerID == actorID {
		return nil
	}
	var granted bool
	query = `SELECT state='active' AND 'orders'=ANY(permissions) AND $3=ANY(permissions)
		FROM dsh.store_access_grants WHERE store_id=$1 AND delegate_actor_id=$2 AND owner_partner_actor_id=$4`
	if lock {
		query += " FOR SHARE"
	}
	err := tx.QueryRowContext(ctx, query, storeID, actorID, permission, ownerID).Scan(&granted)
	if errors.Is(err, sql.ErrNoRows) || err == nil && !granted {
		return ErrOrderNotFound
	}
	return err
}

func ListIndependentOrdersForPartner(ctx context.Context, db *sql.DB, storeID, actorID string, limit int, rawCursor string) (IndependentPartnerOrderPage, error) {
	if !validIndependentPartnerOrderID(storeID) || actorID == "" || limit < 1 || limit > 100 || len(rawCursor) > 1024 {
		return IndependentPartnerOrderPage{}, ErrIndependentPartnerOrderInvalid
	}
	var cursor independentOrderCursor
	if rawCursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(rawCursor)
		if err != nil || json.Unmarshal(raw, &cursor) != nil || cursor.StoreID != storeID ||
			!validIndependentPartnerOrderID(cursor.OrderID) || cursor.At.IsZero() {
			return IndependentPartnerOrderPage{}, ErrIndependentPartnerOrderInvalid
		}
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return IndependentPartnerOrderPage{}, err
	}
	defer tx.Rollback()
	if err := authorizeIndependentPartnerOrders(ctx, tx, storeID, actorID, "orders", false); err != nil {
		return IndependentPartnerOrderPage{}, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT o.id,o.store_id,o.state,o.version,o.total_amount_minor,o.created_at,
		COALESCE((SELECT jsonb_agg(jsonb_build_object('offerId',l.offer_id,'productName',l.product_name,
			'variantTitle',l.variant_title,'quantityBaseUnits',l.quantity_base_units,'lineAmountMinor',l.line_amount_minor)
			ORDER BY l.offer_id) FROM dsh.independent_direct_order_lines l
			WHERE l.order_id=o.id AND l.store_id=o.store_id),'[]'::jsonb)
		FROM dsh.independent_direct_orders o WHERE o.store_id=$1 AND o.fulfillment_mode='CUSTOMER_PICKUP'
		  AND ($2='' OR (o.created_at,o.id)<($3,$2))
		ORDER BY o.created_at DESC,o.id DESC LIMIT $4`, storeID, cursor.OrderID, cursor.At, limit+1)
	if err != nil {
		return IndependentPartnerOrderPage{}, err
	}
	defer rows.Close()
	page := IndependentPartnerOrderPage{Orders: make([]IndependentPartnerOrder, 0, limit)}
	for rows.Next() {
		if len(page.Orders) == limit {
			last := page.Orders[limit-1]
			raw, err := json.Marshal(independentOrderCursor{StoreID: storeID, OrderID: last.OrderID, At: last.CreatedAt})
			if err != nil {
				return IndependentPartnerOrderPage{}, err
			}
			page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
			break
		}
		var record IndependentPartnerOrder
		var lines []byte
		if err := rows.Scan(&record.OrderID, &record.StoreID, &record.State, &record.Version, &record.TotalMinor, &record.CreatedAt, &lines); err != nil {
			return IndependentPartnerOrderPage{}, err
		}
		if err := json.Unmarshal(lines, &record.Lines); err != nil {
			return IndependentPartnerOrderPage{}, err
		}
		page.Orders = append(page.Orders, record)
	}
	if err := rows.Err(); err != nil {
		return IndependentPartnerOrderPage{}, err
	}
	if err := rows.Close(); err != nil {
		return IndependentPartnerOrderPage{}, err
	}
	return page, tx.Commit()
}

func independentPickupTransitionAllowed(from, to string) bool {
	switch from {
	case "SUBMITTED":
		return to == "ACCEPTED" || to == "REJECTED"
	case "ACCEPTED":
		return to == "PREPARING"
	case "PREPARING":
		return to == "READY"
	case "READY":
		return to == "COMPLETED"
	default:
		return false
	}
}

func TransitionIndependentOrderForPartner(ctx context.Context, db *sql.DB, storeID, orderID, actorID string, input IndependentPartnerOrderTransition) (IndependentDirectOrderStatus, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if !validIndependentPartnerOrderID(storeID) || !validIndependentPartnerOrderID(orderID) ||
		actorID == "" || input.ExpectedVersion < 1 || !utf8.ValidString(input.Reason) ||
		strings.ContainsAny(input.Reason, "\x00\r\n") || utf8.RuneCountInString(input.Reason) > 300 ||
		(input.State == "REJECTED" && input.Reason == "") || (input.State != "REJECTED" && input.Reason != "") {
		return IndependentDirectOrderStatus{}, ErrIndependentPartnerOrderInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return IndependentDirectOrderStatus{}, err
	}
	defer tx.Rollback()
	if err := authorizeIndependentPartnerOrders(ctx, tx, storeID, actorID, "fulfillment", true); err != nil {
		return IndependentDirectOrderStatus{}, err
	}
	status := IndependentDirectOrderStatus{OrderID: orderID, StoreID: storeID}
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.independent_direct_orders
		WHERE id=$1 AND store_id=$2 AND fulfillment_mode='CUSTOMER_PICKUP' FOR UPDATE`, orderID, storeID).Scan(&status.State, &status.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentDirectOrderStatus{}, ErrOrderNotFound
	}
	if err != nil {
		return IndependentDirectOrderStatus{}, err
	}
	if status.Version != input.ExpectedVersion {
		// The order row lock serializes the version edge and its audit event.
		// Replaying that exact edge returns current state even after a later transition.
		var replay bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.independent_direct_order_audit
			WHERE order_id=$1 AND expected_version=$2 AND event_type='partner_transition'
			AND actor_id=$3 AND to_state=$4 AND COALESCE(reason,'')=$5)`,
			orderID, input.ExpectedVersion, actorID, input.State, input.Reason).Scan(&replay); err != nil {
			return IndependentDirectOrderStatus{}, err
		}
		if replay {
			return status, tx.Commit()
		}
		return IndependentDirectOrderStatus{}, ErrIndependentPartnerOrderConflict
	}
	if !independentPickupTransitionAllowed(status.State, input.State) {
		return IndependentDirectOrderStatus{}, ErrIndependentPartnerOrderConflict
	}
	previous := status.State
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.independent_direct_orders SET state=$3,version=version+1,updated_at=clock_timestamp()
		WHERE id=$1 AND store_id=$2 RETURNING state,version`, orderID, storeID, input.State).Scan(&status.State, &status.Version); err != nil {
		return IndependentDirectOrderStatus{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.independent_direct_order_audit
		(order_id,actor_id,event_type,from_state,to_state,expected_version,result_version,reason)
		VALUES($1,$2,'partner_transition',$3,$4,$5,$6,NULLIF($7,''))`,
		orderID, actorID, previous, status.State, input.ExpectedVersion, status.Version, input.Reason); err != nil {
		return IndependentDirectOrderStatus{}, err
	}
	return status, tx.Commit()
}
