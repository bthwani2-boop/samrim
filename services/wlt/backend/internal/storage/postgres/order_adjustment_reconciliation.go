package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrOrderAdjustmentReconciliationInput    = errors.New("order adjustment reconciliation case input is invalid")
	ErrOrderAdjustmentReconciliationConflict = errors.New("order adjustment reconciliation case conflicts with canonical facts")
	ErrOrderAdjustmentReconciliationNotFound = errors.New("order adjustment reconciliation case was not found")
)

type OrderAdjustmentReconciliationCaseInput struct {
	OrderID          string
	AdjustmentID     string
	PaymentIntentID  string
	AdjustmentKind   string
	RequestedByActor string
	CustomerActorID  string
	ActingActorID    string
	IdempotencyKey   string
	CorrelationID    string
}

type OrderAdjustmentReconciliationCase struct {
	ID               string    `json:"id"`
	OrderID          string    `json:"orderId"`
	AdjustmentID     string    `json:"adjustmentId"`
	PaymentIntentID  string    `json:"paymentIntentId"`
	AdjustmentKind   string    `json:"adjustmentKind"`
	RequestedByActor string    `json:"requestedByActorId"`
	CustomerActorID  string    `json:"customerActorId"`
	State            string    `json:"state"`
	ReasonCode       string    `json:"reasonCode"`
	IdempotencyKey   string    `json:"idempotencyKey"`
	RequestHash      string    `json:"requestHash"`
	CorrelationID    string    `json:"correlationId"`
	CreatedAt        time.Time `json:"createdAt"`
}

func orderAdjustmentCaseRequestHash(input OrderAdjustmentReconciliationCaseInput) string {
	return hashFacts("order-adjustment-reconciliation-case", strings.TrimSpace(input.OrderID), strings.TrimSpace(input.AdjustmentID), strings.TrimSpace(input.PaymentIntentID), strings.TrimSpace(input.AdjustmentKind), strings.TrimSpace(input.RequestedByActor), strings.TrimSpace(input.CustomerActorID), strings.TrimSpace(input.ActingActorID))
}

func scanOrderAdjustmentReconciliationCase(row interface{ Scan(...any) error }) (OrderAdjustmentReconciliationCase, error) {
	var item OrderAdjustmentReconciliationCase
	err := row.Scan(&item.ID, &item.OrderID, &item.AdjustmentID, &item.PaymentIntentID, &item.AdjustmentKind, &item.RequestedByActor, &item.CustomerActorID, &item.State, &item.ReasonCode, &item.IdempotencyKey, &item.RequestHash, &item.CorrelationID, &item.CreatedAt)
	return item, err
}

const (
	readOrderAdjustmentCaseByIdempotencyKeySQL = `SELECT id,order_id,adjustment_id,payment_intent_id,adjustment_kind,requested_by_actor_id,customer_actor_id,state,reason_code,idempotency_key,request_hash,correlation_id,created_at
		FROM wlt.order_adjustment_reconciliation_cases WHERE idempotency_key=$1 FOR UPDATE`
	readOrderAdjustmentCaseByOrderAndAdjustmentSQL = `SELECT id,order_id,adjustment_id,payment_intent_id,adjustment_kind,requested_by_actor_id,customer_actor_id,state,reason_code,idempotency_key,request_hash,correlation_id,created_at
		FROM wlt.order_adjustment_reconciliation_cases WHERE order_id=$1 AND adjustment_id=$2 FOR UPDATE`
	insertOrderAdjustmentReconciliationCaseSQL = `INSERT INTO wlt.order_adjustment_reconciliation_cases
		(id,order_id,adjustment_id,payment_intent_id,adjustment_kind,requested_by_actor_id,customer_actor_id,state,reason_code,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,'RECONCILIATION_REQUIRED','ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED',$8,$9,$10)
		RETURNING id,order_id,adjustment_id,payment_intent_id,adjustment_kind,requested_by_actor_id,customer_actor_id,state,reason_code,idempotency_key,request_hash,correlation_id,created_at`
	listOrderAdjustmentCasesByOrderSQL = `SELECT id,order_id,adjustment_id,payment_intent_id,adjustment_kind,requested_by_actor_id,customer_actor_id,state,reason_code,idempotency_key,request_hash,correlation_id,created_at
		FROM wlt.order_adjustment_reconciliation_cases WHERE order_id=$1 ORDER BY created_at ASC,id`
)

func RecordOrderAdjustmentReconciliationCase(ctx context.Context, db *sql.DB, input OrderAdjustmentReconciliationCaseInput) (OrderAdjustmentReconciliationCase, bool, error) {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.AdjustmentID = strings.TrimSpace(input.AdjustmentID)
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.AdjustmentKind = strings.TrimSpace(input.AdjustmentKind)
	input.RequestedByActor = strings.TrimSpace(input.RequestedByActor)
	input.CustomerActorID = strings.TrimSpace(input.CustomerActorID)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.OrderID == "" || len(input.OrderID) > 128 || input.AdjustmentID == "" || len(input.AdjustmentID) > 128 || input.PaymentIntentID == "" || len(input.PaymentIntentID) > 128 || (input.AdjustmentKind != "REMOVE_ITEM" && input.AdjustmentKind != "SUBSTITUTE_ITEM" && input.AdjustmentKind != "SET_ACTUAL_QUANTITY") || input.RequestedByActor == "" || len(input.RequestedByActor) > 128 || input.CustomerActorID == "" || len(input.CustomerActorID) > 128 || input.ActingActorID == "" || input.ActingActorID != input.CustomerActorID || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return OrderAdjustmentReconciliationCase{}, false, ErrOrderAdjustmentReconciliationInput
	}
	requestHash := orderAdjustmentCaseRequestHash(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:order-adjustment-reconciliation:"+input.IdempotencyKey); err != nil {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:order-adjustment-reconciliation:"+input.OrderID+":"+input.AdjustmentID); err != nil {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	item, err := scanOrderAdjustmentReconciliationCase(tx.QueryRowContext(ctx, readOrderAdjustmentCaseByIdempotencyKeySQL, input.IdempotencyKey))
	if err == nil {
		if item.RequestHash != requestHash {
			return OrderAdjustmentReconciliationCase{}, false, ErrOrderAdjustmentReconciliationConflict
		}
		if err := tx.Commit(); err != nil {
			return OrderAdjustmentReconciliationCase{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	item, err = scanOrderAdjustmentReconciliationCase(tx.QueryRowContext(ctx, readOrderAdjustmentCaseByOrderAndAdjustmentSQL, input.OrderID, input.AdjustmentID))
	if err == nil {
		if item.RequestHash != requestHash {
			return OrderAdjustmentReconciliationCase{}, false, ErrOrderAdjustmentReconciliationConflict
		}
		if err := tx.Commit(); err != nil {
			return OrderAdjustmentReconciliationCase{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	var allocatedOrderID, payerActorID string
	if err := tx.QueryRowContext(ctx, `SELECT allocation.order_id,intent.payer_actor_id
		FROM wlt.customer_payment_allocations allocation
		JOIN wlt.payment_intents intent ON intent.id=allocation.payment_intent_id
		WHERE allocation.payment_intent_id=$1`, input.PaymentIntentID).Scan(&allocatedOrderID, &payerActorID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OrderAdjustmentReconciliationCase{}, false, ErrOrderAdjustmentReconciliationNotFound
		}
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	if allocatedOrderID != input.OrderID || payerActorID != input.CustomerActorID {
		return OrderAdjustmentReconciliationCase{}, false, ErrOrderAdjustmentReconciliationConflict
	}
	id, err := newID("order_adjustment_case")
	if err != nil {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	item, err = scanOrderAdjustmentReconciliationCase(tx.QueryRowContext(ctx, insertOrderAdjustmentReconciliationCaseSQL,
		id, input.OrderID, input.AdjustmentID, input.PaymentIntentID, input.AdjustmentKind, input.RequestedByActor, input.CustomerActorID, input.IdempotencyKey, requestHash, input.CorrelationID))
	if err != nil {
		return OrderAdjustmentReconciliationCase{}, false, fmt.Errorf("record WLT order adjustment reconciliation case: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return OrderAdjustmentReconciliationCase{}, false, err
	}
	return item, false, nil
}

func ListOrderAdjustmentReconciliationCases(ctx context.Context, db *sql.DB, orderID string) ([]OrderAdjustmentReconciliationCase, error) {
	orderID = strings.TrimSpace(orderID)
	if db == nil || orderID == "" || len(orderID) > 128 {
		return nil, ErrOrderAdjustmentReconciliationInput
	}
	rows, err := db.QueryContext(ctx, listOrderAdjustmentCasesByOrderSQL, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]OrderAdjustmentReconciliationCase, 0)
	for rows.Next() {
		item, err := scanOrderAdjustmentReconciliationCase(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
