package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

var (
	ErrCustomerContactInvalid     = errors.New("customer order contact input is invalid")
	ErrCustomerContactConflict    = errors.New("customer order contact decision is stale or already confirmed")
	ErrCustomerContactIdempotency = errors.New("customer order contact idempotency conflict")
)

type CustomerOrderContactReview struct {
	OrderID                  string     `json:"orderId"`
	State                    string     `json:"state"`
	AttemptCount             int        `json:"attemptCount"`
	Version                  int        `json:"version"`
	LastActorID              string     `json:"lastActorId"`
	LastAttemptAt            *time.Time `json:"lastAttemptAt,omitempty"`
	ConfirmedAt              *time.Time `json:"confirmedAt,omitempty"`
	VerifiedSuccessfulOrders int        `json:"verifiedSuccessfulOrders"`
	LegacyExempt             bool       `json:"legacyExempt"`
	Trusted                  bool       `json:"trusted"`
	NeedsContact             bool       `json:"needsContact"`
}

func validCustomerContactDecision(decision string) bool {
	switch decision {
	case "NO_ANSWER", "CONFIRMED", "DENIED", "WRONG_NUMBER":
		return true
	}
	return false
}

// Contact confirmation is not an order transition. Trust is derived only from
// a CONFIRMED contact on an order with the canonical completion audit event.
func ReadCustomerOrderContactReview(ctx context.Context, db *sql.DB, orderID string) (CustomerOrderContactReview, error) {
	var record CustomerOrderContactReview
	var clientActorID, orderState string
	if err := db.QueryRowContext(ctx, "SELECT client_actor_id,state FROM dsh.commerce_orders WHERE id=$1", orderID).Scan(&clientActorID, &orderState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return record, ErrOrderNotFound
		}
		return record, err
	}
	record.OrderID = orderID
	var lastAt, confirmedAt sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT state,attempt_count,version,last_actor_id,last_attempt_at,confirmed_at
        FROM dsh.customer_order_contact_reviews WHERE order_id=$1`, orderID).Scan(&record.State, &record.AttemptCount, &record.Version, &record.LastActorID, &lastAt, &confirmedAt)
	if errors.Is(err, sql.ErrNoRows) {
		record.State = "PENDING"
	} else if err != nil {
		return record, err
	}
	if lastAt.Valid {
		t := lastAt.Time
		record.LastAttemptAt = &t
	}
	if confirmedAt.Valid {
		t := confirmedAt.Time
		record.ConfirmedAt = &t
	}

	// A completion without the corresponding owner audit is not a success.
	const successful = `WITH completed AS (
        SELECT o.id,o.client_actor_id,o.created_at,
          (SELECT min(a.created_at) FROM dsh.captain_audit a WHERE a.order_id=o.id AND a.event_type='delivery_completed') AS completed_at
        FROM dsh.commerce_orders o
        WHERE o.client_actor_id=$1 AND o.state='DELIVERED' AND o.fulfillment_mode<>'CUSTOMER_PICKUP'
        UNION ALL
        SELECT o.id,o.client_actor_id,o.created_at,
          (SELECT min(a.created_at) FROM dsh.commerce_order_audit a WHERE a.order_id=o.id AND a.event_type='order_picked_up') AS completed_at
        FROM dsh.commerce_orders o
        WHERE o.client_actor_id=$1 AND o.state='PICKED_UP' AND o.fulfillment_mode='CUSTOMER_PICKUP'
    ) SELECT
      count(*) FILTER (WHERE c.state='CONFIRMED')::integer,
      count(*) FILTER (WHERE completed_at < (SELECT applied_at FROM dsh.schema_migrations WHERE version=147))::integer
    FROM completed t LEFT JOIN dsh.customer_order_contact_reviews c ON c.order_id=t.id
    WHERE completed_at IS NOT NULL`
	var oldSuccessful int
	if err := db.QueryRowContext(ctx, successful, clientActorID).Scan(&record.VerifiedSuccessfulOrders, &oldSuccessful); err != nil {
		return record, err
	}
	record.LegacyExempt = oldSuccessful >= 3
	record.Trusted = record.VerifiedSuccessfulOrders >= 3 || record.LegacyExempt
	record.NeedsContact = !record.Trusted && record.State != "CONFIRMED" &&
		orderState != "DELIVERED" && orderState != "PICKED_UP" && orderState != "REJECTED" && orderState != "CANCELLED"
	return record, nil
}

// RecordCustomerOrderContactDecision stores the actual operator's result in one
// transaction. Replays are safe; different facts for one key are rejected.
func RecordCustomerOrderContactDecision(ctx context.Context, db *sql.DB, orderID, actorID, decision, idempotencyKey, correlationID string, expectedVersion int) (CustomerOrderContactReview, bool, error) {
	orderID = strings.TrimSpace(orderID)
	actorID = strings.TrimSpace(actorID)
	decision = strings.TrimSpace(decision)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || orderID == "" || len(orderID) > 128 || actorID == "" || len(actorID) > 128 ||
		!validCustomerContactDecision(decision) || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 ||
		len(correlationID) < 8 || len(correlationID) > 128 || expectedVersion < 0 {
		return CustomerOrderContactReview{}, false, ErrCustomerContactInvalid
	}
	facts := orderID + "|" + actorID + "|" + decision + "|" + strconv.Itoa(expectedVersion)
	digest := sha256.Sum256([]byte(facts))
	hash := hex.EncodeToString(digest[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	defer tx.Rollback()
	var customerID, state string
	if err = tx.QueryRowContext(ctx, "SELECT client_actor_id,state FROM dsh.commerce_orders WHERE id=$1 FOR SHARE", orderID).Scan(&customerID, &state); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CustomerOrderContactReview{}, false, ErrOrderNotFound
		}
		return CustomerOrderContactReview{}, false, err
	}
	// Compare replay facts before evaluating a now-stale row version.
	var previousOrder, previousHash string
	err = tx.QueryRowContext(ctx, "SELECT order_id,request_hash FROM dsh.customer_order_contact_events WHERE idempotency_key=$1", idempotencyKey).Scan(&previousOrder, &previousHash)
	if err == nil {
		if previousOrder != orderID || previousHash != hash {
			return CustomerOrderContactReview{}, false, ErrCustomerContactIdempotency
		}
		if err = tx.Commit(); err != nil {
			return CustomerOrderContactReview{}, false, err
		}
		record, readErr := ReadCustomerOrderContactReview(ctx, db, orderID)
		return record, true, readErr
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CustomerOrderContactReview{}, false, err
	}
	if state == "DELIVERED" || state == "PICKED_UP" || state == "REJECTED" || state == "CANCELLED" {
		return CustomerOrderContactReview{}, false, ErrCustomerContactConflict
	}
	// The row lock serializes attempts by distinct operators; the order row
	// share-lock guards against deleting/changing its identity.
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.customer_order_contact_reviews
       (order_id,client_actor_id,state,attempt_count,version,last_actor_id,confirmed_at)
       VALUES($1,$2,'NO_ANSWER',0,0,$3,NULL) ON CONFLICT(order_id) DO NOTHING`, orderID, customerID, actorID); err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	var currentVersion int
	var currentState string
	if err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.customer_order_contact_reviews WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&currentState, &currentVersion); err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	err = tx.QueryRowContext(ctx, "SELECT order_id,request_hash FROM dsh.customer_order_contact_events WHERE idempotency_key=$1", idempotencyKey).Scan(&previousOrder, &previousHash)
	if err == nil {
		if previousOrder != orderID || previousHash != hash {
			return CustomerOrderContactReview{}, false, ErrCustomerContactIdempotency
		}
		if err = tx.Commit(); err != nil {
			return CustomerOrderContactReview{}, false, err
		}
		record, readErr := ReadCustomerOrderContactReview(ctx, db, orderID)
		return record, true, readErr
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CustomerOrderContactReview{}, false, err
	}
	if currentVersion != expectedVersion || currentState == "CONFIRMED" {
		return CustomerOrderContactReview{}, false, ErrCustomerContactConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE dsh.customer_order_contact_reviews
      SET state=$2,attempt_count=attempt_count+1,version=version+1,last_actor_id=$3,
          last_attempt_at=clock_timestamp(),confirmed_at=CASE WHEN $2='CONFIRMED' THEN clock_timestamp() ELSE NULL END,
          updated_at=clock_timestamp()
      WHERE order_id=$1 AND version=$4 AND attempt_count<100`, orderID, decision, actorID, currentVersion)
	if err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	if changed != 1 {
		return CustomerOrderContactReview{}, false, ErrCustomerContactConflict
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.customer_order_contact_events
      (order_id,client_actor_id,decision,operator_actor_id,idempotency_key,request_hash,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, orderID, customerID, decision, actorID, idempotencyKey, hash, correlationID); err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CustomerOrderContactReview{}, false, err
	}
	record, readErr := ReadCustomerOrderContactReview(ctx, db, orderID)
	return record, false, readErr
}
