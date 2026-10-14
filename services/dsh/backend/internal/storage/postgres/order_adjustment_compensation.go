package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// ApplyCompensatedOrderAdjustment closes only the operational post-completion
// incident after WLT returns and confirms its immutable wallet ledger credit.
// The originally completed Order, payment and merchant earning stay unchanged.
func ApplyCompensatedOrderAdjustment(ctx context.Context, db *sql.DB,
	orderID, adjustmentID, operatorID, ledgerTransactionID, correlationID string) (OrderRecord, error) {
	orderID = strings.TrimSpace(orderID)
	adjustmentID = strings.TrimSpace(adjustmentID)
	operatorID = strings.TrimSpace(operatorID)
	ledgerTransactionID = strings.TrimSpace(ledgerTransactionID)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || orderID == "" || adjustmentID == "" || len(orderID) > 128 || len(adjustmentID) > 128 ||
		operatorID == "" || len(operatorID) > 128 || ledgerTransactionID == "" || len(ledgerTransactionID) > 128 ||
		len(correlationID) < 8 || len(correlationID) > 128 {
		return OrderRecord{}, ErrOrderAdjustmentInvalid
	}
	key := "compensation-applied-" + hashFacts(orderID, adjustmentID, ledgerTransactionID)
	requestHash := hashFacts("compensation-applied", orderID, adjustmentID, ledgerTransactionID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var currentOrderState string
	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&currentOrderState, &currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, err
	}
	if currentOrderState != "DELIVERED" && currentOrderState != "PICKED_UP" {
		return OrderRecord{}, ErrOrderAdjustmentConflict
	}
	var adjustmentState string
	var adjustmentVersion int
	err = tx.QueryRowContext(ctx, `SELECT state,version FROM dsh.commerce_order_adjustments
  WHERE order_id=$1 AND id=$2 AND kind='REMOVE_ITEM' FOR UPDATE`, orderID, adjustmentID).
		Scan(&adjustmentState, &adjustmentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, ErrOrderAdjustmentNotFound
	}
	if err != nil {
		return OrderRecord{}, err
	}
	if adjustmentState == "APPLIED" {
		order, err := readOrder(ctx, tx, "o.id=$1", orderID)
		if err != nil {
			return OrderRecord{}, err
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, err
		}
		return order, nil
	}
	if adjustmentState != "FINANCIAL_RECONCILIATION_REQUIRED" {
		return OrderRecord{}, ErrOrderAdjustmentConflict
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dsh.commerce_order_adjustments
  SET state='APPLIED',applied_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  WHERE id=$1`, adjustmentID); err != nil {
		return OrderRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET version=version+1,updated_at=clock_timestamp()
  WHERE id=$1`, orderID); err != nil {
		return OrderRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustment_idempotency(
  idempotency_key,request_hash,operation,adjustment_id,acting_actor_id,result_state,result_version)
  VALUES($1,$2,'adjustment_reconcile',$3,$4,'APPLIED',$5)`,
		key, requestHash, adjustmentID, operatorID, adjustmentVersion+1); err != nil {
		return OrderRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_adjustment_audit(
  event_type,idempotency_key,correlation_id,acting_actor_id,order_id,adjustment_id,
  from_state,to_state,expected_version,result_version,request_hash)
  VALUES('adjustment_reconciled',$1,$2,$3,$4,$5,
   'FINANCIAL_RECONCILIATION_REQUIRED','APPLIED',$6,$7,$8)`,
		key, correlationID, operatorID, orderID, adjustmentID, adjustmentVersion, adjustmentVersion+1, requestHash); err != nil {
		return OrderRecord{}, err
	}
	order, err := readOrder(ctx, tx, "o.id=$1", orderID)
	if err != nil {
		return OrderRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, err
	}
	return order, nil
}
