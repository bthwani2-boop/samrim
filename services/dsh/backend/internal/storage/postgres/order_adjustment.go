package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

var (
	ErrOrderAdjustmentInvalid             = errors.New("order adjustment input is invalid")
	ErrOrderAdjustmentNotFound            = errors.New("order adjustment was not found")
	ErrOrderAdjustmentConflict            = errors.New("order adjustment state or version conflicts")
	ErrOrderAdjustmentIdempotencyConflict = errors.New("order adjustment idempotency key was reused with different facts")
	ErrOrderAdjustmentFinancialRequired   = errors.New("order adjustment requires unresolved financial reconciliation")
)

type OrderAdjustmentRecord struct {
	ID                       string
	OrderID                  string
	OrderLineID              string
	Kind                     string
	State                    string
	ActualQuantityBaseUnits  *int64
	CustomerDecisionRequired bool
	RequestedByActorID       string
	RequestedByRole          string
	CustomerActorID          string
	CustomerDecidedAt        *time.Time
	AppliedAt                *time.Time
	Version                  int
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

type ProposeOrderAdjustmentInput struct {
	OrderID                 string
	OrderLineID             string
	Kind                    string
	ActualQuantityBaseUnits *int64
	ExpectedOrderVersion    int
	RequestedByActorID      string
	RequestedByRole         string
	IdempotencyKey          string
	CorrelationID           string
}

func HashOrderAdjustmentProposal(input ProposeOrderAdjustmentInput) string {
	actualQuantity := ""
	if input.ActualQuantityBaseUnits != nil {
		actualQuantity = strconv.FormatInt(*input.ActualQuantityBaseUnits, 10)
	}
	return hashFacts(strings.TrimSpace(input.OrderID), strings.TrimSpace(input.OrderLineID), strings.TrimSpace(input.Kind), actualQuantity, strconv.Itoa(input.ExpectedOrderVersion), strings.TrimSpace(input.RequestedByActorID), strings.TrimSpace(input.RequestedByRole))
}

func HashOrderAdjustmentDecision(orderID, adjustmentID, customerActorID, decision string, expectedOrderVersion, expectedAdjustmentVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), strings.TrimSpace(adjustmentID), strings.TrimSpace(customerActorID), strings.TrimSpace(decision), strconv.Itoa(expectedOrderVersion), strconv.Itoa(expectedAdjustmentVersion))
}

func scanOrderAdjustment(row rowScanner) (OrderAdjustmentRecord, error) {
	var item OrderAdjustmentRecord
	var actualQuantity sql.NullInt64
	var customerActorID sql.NullString
	var decidedAt, appliedAt sql.NullTime
	err := row.Scan(&item.ID, &item.OrderID, &item.OrderLineID, &item.Kind, &item.State, &actualQuantity, &item.CustomerDecisionRequired,
		&item.RequestedByActorID, &item.RequestedByRole, &customerActorID, &decidedAt, &appliedAt, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if actualQuantity.Valid {
		value := actualQuantity.Int64
		item.ActualQuantityBaseUnits = &value
	}
	if customerActorID.Valid {
		item.CustomerActorID = customerActorID.String
	}
	if decidedAt.Valid {
		value := decidedAt.Time
		item.CustomerDecidedAt = &value
	}
	if appliedAt.Valid {
		value := appliedAt.Time
		item.AppliedAt = &value
	}
	return item, err
}

const orderAdjustmentColumns = `id,order_id,order_line_id,kind,state,actual_quantity_base_units,customer_decision_required,requested_by_actor_id,requested_by_role,customer_actor_id,customer_decided_at,applied_at,version,created_at,updated_at`

func listOrderAdjustments(ctx context.Context, source queryer, orderID string) ([]OrderAdjustmentRecord, error) {
	rows, err := source.QueryContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE order_id=$1 ORDER BY created_at ASC,id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]OrderAdjustmentRecord, 0)
	for rows.Next() {
		item, err := scanOrderAdjustment(rows)
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

func ReadOrderAdjustment(ctx context.Context, db *sql.DB, orderID, adjustmentID string) (OrderAdjustmentRecord, string, string, error) {
	orderID, adjustmentID = strings.TrimSpace(orderID), strings.TrimSpace(adjustmentID)
	if db == nil || orderID == "" || adjustmentID == "" {
		return OrderAdjustmentRecord{}, "", "", ErrOrderAdjustmentInvalid
	}
	item, err := scanOrderAdjustment(db.QueryRowContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE order_id=$1 AND id=$2`, orderID, adjustmentID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderAdjustmentRecord{}, "", "", ErrOrderAdjustmentNotFound
	}
	if err != nil {
		return OrderAdjustmentRecord{}, "", "", err
	}
	var clientActorID, paymentIntentID string
	if err := db.QueryRowContext(ctx, `SELECT client_actor_id,payment_intent_id FROM dsh.commerce_orders WHERE id=$1`, orderID).Scan(&clientActorID, &paymentIntentID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OrderAdjustmentRecord{}, "", "", ErrOrderNotFound
		}
		return OrderAdjustmentRecord{}, "", "", err
	}
	return item, clientActorID, paymentIntentID, nil
}

func ProposeOrderAdjustment(ctx context.Context, db *sql.DB, input ProposeOrderAdjustmentInput) (OrderRecord, OrderAdjustmentRecord, bool, error) {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.OrderLineID = strings.TrimSpace(input.OrderLineID)
	input.Kind = strings.TrimSpace(input.Kind)
	input.RequestedByActorID = strings.TrimSpace(input.RequestedByActorID)
	input.RequestedByRole = strings.TrimSpace(input.RequestedByRole)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.OrderID == "" || input.OrderLineID == "" || (input.Kind != "REMOVE_ITEM" && input.Kind != "SET_ACTUAL_QUANTITY") || input.ExpectedOrderVersion < 1 || input.RequestedByActorID == "" || (input.RequestedByRole != "partner" && input.RequestedByRole != "operator") || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentInvalid
	}
	if (input.Kind == "REMOVE_ITEM" && input.ActualQuantityBaseUnits != nil) || (input.Kind == "SET_ACTUAL_QUANTITY" && (input.ActualQuantityBaseUnits == nil || *input.ActualQuantityBaseUnits < 1)) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentInvalid
	}
	requestHash := HashOrderAdjustmentProposal(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-adjustment:"+input.IdempotencyKey); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	var storedHash, storedOperation, adjustmentID string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,operation,adjustment_id FROM dsh.commerce_order_adjustment_idempotency WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(&storedHash, &storedOperation, &adjustmentID)
	if err == nil {
		if storedHash != requestHash || storedOperation != "adjustment_propose" {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentIdempotencyConflict
		}
		order, err := readOrder(ctx, tx, "o.id=$1", input.OrderID)
		if err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		adjustment, err := scanOrderAdjustment(tx.QueryRowContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE id=$1 AND order_id=$2`, adjustmentID, input.OrderID))
		if err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		return order, adjustment, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders o WHERE o.id=$1 FOR UPDATE OF o", input.OrderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if current.Version != input.ExpectedOrderVersion || (current.State != "PARTNER_ACCEPTED" && current.State != "PREPARING") || current.PaymentState != "REQUIRES_COLLECTION" {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentConflict
	}
	var lineMeasurement, quantityPolicy string
	var requestedQuantity int64
	var minimum, maximum, step sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT measurement_kind,quantity_policy,requested_quantity_base_units,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units
		FROM dsh.commerce_order_lines WHERE order_id=$1 AND id=$2 FOR UPDATE`, input.OrderID, input.OrderLineID).Scan(&lineMeasurement, &quantityPolicy, &requestedQuantity, &minimum, &maximum, &step)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentNotFound
	}
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if input.Kind == "SET_ACTUAL_QUANTITY" {
		actual := *input.ActualQuantityBaseUnits
		if lineMeasurement != "VARIABLE_MEASURE" || quantityPolicy != "VARIABLE_MEASURE" || !minimum.Valid || !maximum.Valid || !step.Valid || step.Int64 <= 0 || actual >= requestedQuantity || actual < minimum.Int64 || actual > maximum.Int64 || (actual-minimum.Int64)%step.Int64 != 0 {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentInvalid
		}
	}
	var openAdjustmentID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM dsh.commerce_order_adjustments WHERE order_line_id=$1 AND state IN ('PROPOSED','APPROVED','FINANCIAL_RECONCILIATION_REQUIRED')`, input.OrderLineID).Scan(&openAdjustmentID)
	if err == nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	newOrderVersion := current.Version + 1
	if result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET version=$2,updated_at=clock_timestamp() WHERE id=$1 AND version=$3`, input.OrderID, newOrderVersion, input.ExpectedOrderVersion); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	} else if count, err := result.RowsAffected(); err != nil || count != 1 {
		if err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentConflict
	}
	newAdjustmentID, err := newID("order_adjustment")
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustments(id,order_id,order_line_id,kind,state,actual_quantity_base_units,customer_decision_required,requested_by_actor_id,requested_by_role,customer_actor_id)
		VALUES($1,$2,$3,$4,'PROPOSED',$5,true,$6,$7,$8)`, newAdjustmentID, input.OrderID, input.OrderLineID, input.Kind, input.ActualQuantityBaseUnits, input.RequestedByActorID, input.RequestedByRole, current.ClientActorID); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustment_idempotency(idempotency_key,request_hash,operation,adjustment_id,acting_actor_id,result_state,result_version)
		VALUES($1,$2,'adjustment_propose',$3,$4,'PROPOSED',1)`, input.IdempotencyKey, requestHash, newAdjustmentID, input.RequestedByActorID); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,adjustment_id,from_state,to_state,expected_version,result_version,request_hash)
		VALUES('adjustment_proposed',$1,$2,$3,$4,$5,NULL,'PROPOSED',0,1,$6)`, input.IdempotencyKey, input.CorrelationID, input.RequestedByActorID, input.OrderID, newAdjustmentID, requestHash); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	order, err := readOrder(ctx, tx, "o.id=$1", input.OrderID)
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	adjustment, err := scanOrderAdjustment(tx.QueryRowContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE id=$1`, newAdjustmentID))
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	return order, adjustment, false, nil
}

func DecideOrderAdjustment(ctx context.Context, db *sql.DB, orderID, adjustmentID, customerActorID, decision string, expectedOrderVersion, expectedAdjustmentVersion int, idempotencyKey, correlationID string) (OrderRecord, OrderAdjustmentRecord, bool, error) {
	orderID, adjustmentID, customerActorID, decision = strings.TrimSpace(orderID), strings.TrimSpace(adjustmentID), strings.TrimSpace(customerActorID), strings.TrimSpace(decision)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || orderID == "" || adjustmentID == "" || customerActorID == "" || (decision != "ACCEPT" && decision != "REJECT") || expectedOrderVersion < 1 || expectedAdjustmentVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentInvalid
	}
	requestHash := HashOrderAdjustmentDecision(orderID, adjustmentID, customerActorID, decision, expectedOrderVersion, expectedAdjustmentVersion)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-adjustment:"+idempotencyKey); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	var storedHash, storedOperation, storedAdjustmentID string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,operation,adjustment_id FROM dsh.commerce_order_adjustment_idempotency WHERE idempotency_key=$1`, idempotencyKey).Scan(&storedHash, &storedOperation, &storedAdjustmentID)
	if err == nil {
		if storedHash != requestHash || storedOperation != "adjustment_decide" || storedAdjustmentID != adjustmentID {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentIdempotencyConflict
		}
		order, err := readOrder(ctx, tx, "o.id=$1", orderID)
		if err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		adjustment, err := scanOrderAdjustment(tx.QueryRowContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE id=$1 AND order_id=$2`, adjustmentID, orderID))
		if err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
		return order, adjustment, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders o WHERE o.id=$1 FOR UPDATE OF o", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if current.ClientActorID != customerActorID {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderNotFound
	}
	if current.Version != expectedOrderVersion || (current.State != "PARTNER_ACCEPTED" && current.State != "PREPARING") {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentConflict
	}
	adjustment, err := scanOrderAdjustment(tx.QueryRowContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE id=$1 AND order_id=$2 FOR UPDATE`, adjustmentID, orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentNotFound
	}
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if adjustment.State != "PROPOSED" || adjustment.Version != expectedAdjustmentVersion || !adjustment.CustomerDecisionRequired || adjustment.CustomerActorID != customerActorID {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrOrderAdjustmentConflict
	}
	resultState := "REJECTED"
	if decision == "ACCEPT" {
		resultState = "FINANCIAL_RECONCILIATION_REQUIRED"
	}
	newOrderVersion, newAdjustmentVersion := current.Version+1, adjustment.Version+1
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_adjustments SET state=$2,customer_decided_at=clock_timestamp(),version=$3,updated_at=clock_timestamp() WHERE id=$1`, adjustmentID, resultState, newAdjustmentVersion); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET version=$2,updated_at=clock_timestamp() WHERE id=$1 AND version=$3`, orderID, newOrderVersion, expectedOrderVersion); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustment_idempotency(idempotency_key,request_hash,operation,adjustment_id,acting_actor_id,result_state,result_version)
		VALUES($1,$2,'adjustment_decide',$3,$4,$5,$6)`, idempotencyKey, requestHash, adjustmentID, customerActorID, resultState, newAdjustmentVersion); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,adjustment_id,from_state,to_state,expected_version,result_version,request_hash)
		VALUES('adjustment_decided',$1,$2,$3,$4,$5,'PROPOSED',$6,$7,$8,$9)`, idempotencyKey, correlationID, customerActorID, orderID, adjustmentID, resultState, expectedAdjustmentVersion, newAdjustmentVersion, requestHash); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if decision == "ACCEPT" {
		if current.PaymentIntentID == nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, ErrPaymentStateConflict
		}
		financialKey := "order-adjustment-reconciliation-" + hashFacts(adjustmentID)
		if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "ORDER_ADJUSTMENT_RECONCILIATION", SourceRef: adjustmentID, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, IdempotencyKey: financialKey, CorrelationID: correlationID, ActingActorID: customerActorID}); err != nil {
			return OrderRecord{}, OrderAdjustmentRecord{}, false, err
		}
	}
	order, err := readOrder(ctx, tx, "o.id=$1", orderID)
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	adjustment, err = scanOrderAdjustment(tx.QueryRowContext(ctx, `SELECT `+orderAdjustmentColumns+` FROM dsh.commerce_order_adjustments WHERE id=$1`, adjustmentID))
	if err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, OrderAdjustmentRecord{}, false, err
	}
	return order, adjustment, false, nil
}
