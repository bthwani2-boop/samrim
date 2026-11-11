package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func RecordManualTransfer(ctx context.Context, db *sql.DB, input RecordTransferInput) (ManualTransferExecutionRecord, error) {
	input.BatchID, input.PayoutID, input.ActorID = strings.TrimSpace(input.BatchID), strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.ExternalReference, input.ReceiptDocumentID = strings.TrimSpace(input.ExternalReference), strings.TrimSpace(input.ReceiptDocumentID)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.BatchID, 1, 128) == "" || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.ExternalReference, 1, 160) == "" || boundedText(input.ReceiptDocumentID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("transfer-executed", input.BatchID, input.PayoutID, input.ActorID, input.ExternalReference, input.ReceiptDocumentID)
	if found, payoutID, batchID, err := existingPayoutAudit(ctx, tx, "TRANSFER_EXECUTED", input.IdempotencyKey, hash); err != nil {
		return ManualTransferExecutionRecord{}, err
	} else if found {
		item, err := readManualTransfer(ctx, tx, payoutID)
		if err != nil {
			return ManualTransferExecutionRecord{}, err
		}
		_ = batchID
		if err := tx.Commit(); err != nil {
			return ManualTransferExecutionRecord{}, err
		}
		return item, nil
	}
	var batch SettlementBatchRecord
	if err := scanSettlementBatch(ctx, tx, input.BatchID, true, &batch); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if batch.Status != "FROZEN" && batch.Status != "EXECUTION_IN_PROGRESS" {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchState
	}
	var snapshotHash, providerKey, destinationID string
	var amount int64
	var version int
	var currency string
	if err := tx.QueryRowContext(ctx, `SELECT i.snapshot_hash,i.amount_minor,i.currency,i.destination_id,i.destination_version,s.provider_key FROM wlt.settlement_batch_items i JOIN wlt.approved_payout_snapshots s ON s.payout_id=i.payout_id WHERE i.batch_id=$1 AND i.payout_id=$2 FOR UPDATE`, input.BatchID, input.PayoutID).Scan(&snapshotHash, &amount, &currency, &destinationID, &version, &providerKey); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	var payoutStatus string
	if err := tx.QueryRowContext(ctx, "SELECT status FROM wlt.payout_requests WHERE id=$1 FOR UPDATE", input.PayoutID).Scan(&payoutStatus); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if payoutStatus != "FROZEN" {
		return ManualTransferExecutionRecord{}, ErrTransferState
	}
	transferID, err := newID("transfer")
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	var receiptPurpose string
	if err := tx.QueryRowContext(ctx, "SELECT purpose FROM wlt.finance_evidence_documents WHERE id=$1 FOR SHARE", input.ReceiptDocumentID).Scan(&receiptPurpose); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrFinanceEvidenceNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	} else if receiptPurpose != "TRANSFER_RECEIPT" {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	if err := claimFinanceTransferReceipt(ctx, tx, input.ReceiptDocumentID, "BENEFICIARY_PAYOUT_TRANSFER", transferID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.manual_transfer_executions(id,batch_id,payout_id,approved_snapshot_hash,executed_by,provider_key,external_transfer_reference,amount_minor,currency,destination_id,destination_version,legacy_evidence_reference,receipt_document_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'', $12)`, transferID, input.BatchID, input.PayoutID, snapshotHash, input.ActorID, providerKey, input.ExternalReference, amount, currency, destinationID, version, input.ReceiptDocumentID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='EXECUTED',updated_at=clock_timestamp() WHERE id=$1", input.PayoutID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := refreshManualTransferBatchProgress(ctx, tx, input.BatchID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "TRANSFER_EXECUTED", input.PayoutID, input.BatchID, input.ActorID, "", input.ReceiptDocumentID, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	item, err := readManualTransfer(ctx, tx, input.PayoutID)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	return item, nil
}

func VerifyManualTransfer(ctx context.Context, db *sql.DB, input VerifyTransferInput) (ManualTransferExecutionRecord, error) {
	input.TransferID, input.ActorID = strings.TrimSpace(input.TransferID), strings.TrimSpace(input.ActorID)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.TransferID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:manual-transfer-verify:"+input.IdempotencyKey); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	hash := hashFacts("transfer-verified", input.TransferID, input.ActorID)
	if found, payoutID, _, err := existingPayoutAudit(ctx, tx, "TRANSFER_VERIFIED", input.IdempotencyKey, hash); err != nil {
		return ManualTransferExecutionRecord{}, err
	} else if found {
		item, err := readManualTransfer(ctx, tx, payoutID)
		if err != nil {
			return ManualTransferExecutionRecord{}, err
		}
		if err := tx.Commit(); err != nil {
			return ManualTransferExecutionRecord{}, err
		}
		return item, nil
	}
	var transfer ManualTransferExecutionRecord
	if err := scanManualTransfer(ctx, tx, input.TransferID, true, &transfer); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if transfer.ExecutionStatus != "EXECUTED" {
		return ManualTransferExecutionRecord{}, ErrTransferState
	}
	if transfer.ExecutedBy == input.ActorID {
		return ManualTransferExecutionRecord{}, ErrTransferSeparation
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.manual_transfer_executions SET execution_status='VERIFIED',verified_by=$2,verified_at=clock_timestamp() WHERE id=$1", input.TransferID, input.ActorID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := refreshManualTransferBatchProgress(ctx, tx, transfer.BatchID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "TRANSFER_VERIFIED", transfer.PayoutID, transfer.BatchID, input.ActorID, "", transfer.ReceiptDocumentID, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	item, err := readManualTransfer(ctx, tx, transfer.PayoutID)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	return item, nil
}

func refreshManualTransferBatchProgress(ctx context.Context, tx *sql.Tx, batchID string) error {
	// Take the batch lock before the tally so the next statement observes
	// transfers committed while this transaction waited for another worker.
	var rowCount int
	if err := tx.QueryRowContext(ctx, "SELECT row_count FROM wlt.settlement_batches WHERE id=$1 FOR NO KEY UPDATE", batchID).Scan(&rowCount); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE wlt.settlement_batches b
		SET status=CASE
			WHEN progress.executed < $2 THEN 'EXECUTION_IN_PROGRESS'
			WHEN progress.completed = $2 THEN 'COMPLETED'
			WHEN progress.verified = $2 THEN 'AWAITING_RECONCILIATION'
			ELSE 'AWAITING_VERIFICATION'
		END, updated_at=clock_timestamp()
		FROM (
			SELECT COUNT(t.id) AS executed,
				COUNT(*) FILTER (WHERE t.execution_status IN ('VERIFIED','RECONCILED')) AS verified,
				COUNT(*) FILTER (WHERE t.execution_status='RECONCILED' AND p.status='COMPLETED') AS completed
			FROM wlt.settlement_batch_items i
			JOIN wlt.payout_requests p ON p.id=i.payout_id
			LEFT JOIN wlt.manual_transfer_executions t ON t.batch_id=i.batch_id AND t.payout_id=i.payout_id
			WHERE i.batch_id=$1
		) progress
		WHERE b.id=$1`, batchID, rowCount)
	return err
}
