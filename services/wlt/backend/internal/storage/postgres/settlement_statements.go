package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

func RegisterSettlementStatement(ctx context.Context, db *sql.DB, input SettlementStatementInput) (SettlementStatementRecord, error) {
	input.BatchID = strings.TrimSpace(input.BatchID)
	input.ProviderKey, input.Currency = strings.TrimSpace(input.ProviderKey), strings.ToUpper(strings.TrimSpace(input.Currency))
	input.EvidenceDocumentID = strings.TrimSpace(input.EvidenceDocumentID)
	input.ActorID, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.ActorID), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.ProviderKey, 1, 64) == "" || input.Currency != "YER" || input.PeriodStart.IsZero() || input.PeriodEnd.IsZero() || input.PeriodEnd.Before(input.PeriodStart) || boundedText(input.EvidenceDocumentID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return SettlementStatementRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementStatementRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	requestHash := hashFacts("settlement-statement", input.BatchID, input.ProviderKey, input.Currency, input.PeriodStart.Format("2006-01-02"), input.PeriodEnd.Format("2006-01-02"), input.EvidenceDocumentID, input.ActorID)
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.settlement_statements WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return SettlementStatementRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readSettlementStatement(ctx, tx, existingID)
		if readErr != nil {
			return SettlementStatementRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return SettlementStatementRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SettlementStatementRecord{}, err
	}
	var evidencePurpose string
	if err := tx.QueryRowContext(ctx, "SELECT purpose FROM wlt.finance_evidence_documents WHERE id=$1 FOR SHARE", input.EvidenceDocumentID).Scan(&evidencePurpose); errors.Is(err, sql.ErrNoRows) {
		return SettlementStatementRecord{}, ErrFinanceEvidenceNotFound
	} else if err != nil {
		return SettlementStatementRecord{}, err
	} else if evidencePurpose != "SETTLEMENT_STATEMENT" {
		return SettlementStatementRecord{}, ErrSettlementBatchInput
	}
	if input.BatchID != "" {
		var batchProvider, batchCurrency, batchStatus string
		if err := tx.QueryRowContext(ctx, "SELECT provider_key,currency,status FROM wlt.settlement_batches WHERE id=$1 FOR SHARE", input.BatchID).Scan(&batchProvider, &batchCurrency, &batchStatus); err != nil {
			return SettlementStatementRecord{}, ErrSettlementBatchNotFound
		}
		if batchProvider != input.ProviderKey || batchCurrency != input.Currency || (batchStatus != "FROZEN" && batchStatus != "EXECUTION_IN_PROGRESS" && batchStatus != "AWAITING_VERIFICATION" && batchStatus != "AWAITING_RECONCILIATION" && batchStatus != "COMPLETED") {
			return SettlementStatementRecord{}, ErrSettlementBatchState
		}
	}
	id, err := newID("statement")
	if err != nil {
		return SettlementStatementRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.settlement_statements(id,batch_id,provider_key,currency,period_start,period_end,evidence_document_id,uploaded_by,idempotency_key,request_hash,correlation_id) VALUES($1,NULLIF($2,''),$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, input.BatchID, input.ProviderKey, input.Currency, input.PeriodStart.UTC(), input.PeriodEnd.UTC(), input.EvidenceDocumentID, input.ActorID, input.IdempotencyKey, requestHash, input.CorrelationID)
	if err != nil {
		return SettlementStatementRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "SETTLEMENT_STATEMENT_REGISTERED", "", input.BatchID, input.ActorID, input.PeriodStart.Format("2006-01-02")+".."+input.PeriodEnd.Format("2006-01-02"), input.EvidenceDocumentID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return SettlementStatementRecord{}, err
	}
	item, err := readSettlementStatement(ctx, tx, id)
	if err != nil {
		return SettlementStatementRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return SettlementStatementRecord{}, err
	}
	return item, nil
}

func RecordSettlementStatementRow(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input SettlementStatementRowInput) (SettlementStatementRowRecord, error) {
	input.StatementID, input.ExternalReference = strings.TrimSpace(input.StatementID), strings.TrimSpace(input.ExternalReference)
	input.WalletIdentifier, input.Currency = strings.TrimSpace(input.WalletIdentifier), strings.ToUpper(strings.TrimSpace(input.Currency))
	input.ActorID, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.ActorID), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || boundedText(input.StatementID, 1, 128) == "" || input.RowSequence < 1 || boundedText(input.ExternalReference, 1, 160) == "" || !officialWalletPhoneE164Pattern.MatchString(input.WalletIdentifier) || input.AmountMinor <= 0 || input.Currency != "YER" || input.TransactionAt.IsZero() || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return SettlementStatementRowRecord{}, ErrSettlementBatchInput
	}
	ciphertext, err := cipher.encrypt(input.WalletIdentifier)
	if err != nil {
		return SettlementStatementRowRecord{}, err
	}
	requestHash := hashFacts("settlement-statement-row", input.StatementID, strconv.Itoa(input.RowSequence), input.ExternalReference, input.WalletIdentifier, strconv.FormatInt(input.AmountMinor, 10), input.Currency, input.TransactionAt.UTC().Format(time.RFC3339Nano), input.ActorID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementStatementRowRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.settlement_statement_rows WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return SettlementStatementRowRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readSettlementStatementRow(ctx, tx, existingID)
		if readErr != nil {
			return SettlementStatementRowRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return SettlementStatementRowRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SettlementStatementRowRecord{}, err
	}
	var statementProvider, statementCurrency string
	var periodStart, periodEnd time.Time
	var batchID sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT provider_key,currency,period_start,period_end,batch_id FROM wlt.settlement_statements WHERE id=$1 FOR UPDATE", input.StatementID).Scan(&statementProvider, &statementCurrency, &periodStart, &periodEnd, &batchID); errors.Is(err, sql.ErrNoRows) {
		return SettlementStatementRowRecord{}, ErrSettlementBatchNotFound
	} else if err != nil {
		return SettlementStatementRowRecord{}, err
	}
	if statementCurrency != input.Currency || input.TransactionAt.UTC().Before(periodStart.UTC()) || input.TransactionAt.UTC().After(periodEnd.UTC().Add(24*time.Hour-time.Nanosecond)) {
		return SettlementStatementRowRecord{}, ErrSettlementBatchInput
	}
	rowID, err := newID("statement-row")
	if err != nil {
		return SettlementStatementRowRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.settlement_statement_rows(id,statement_id,row_sequence,external_transfer_reference,destination_identifier_ciphertext,amount_minor,currency,transaction_at,row_hash,recorded_by,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, rowID, input.StatementID, input.RowSequence, input.ExternalReference, ciphertext, input.AmountMinor, input.Currency, input.TransactionAt.UTC(), requestHash, input.ActorID, input.IdempotencyKey, requestHash, input.CorrelationID)
	if err != nil {
		return SettlementStatementRowRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "SETTLEMENT_STATEMENT_ROW_RECORDED", "", batchID.String, input.ActorID, strconv.Itoa(input.RowSequence), rowID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return SettlementStatementRowRecord{}, err
	}
	item, err := readSettlementStatementRow(ctx, tx, rowID)
	if err != nil {
		return SettlementStatementRowRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return SettlementStatementRowRecord{}, err
	}
	_ = statementProvider
	return item, nil
}

func ReconcileManualTransfer(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input ReconcileTransferInput) (ManualTransferExecutionRecord, error) {
	input.TransferID, input.StatementRowID, input.ActorID = strings.TrimSpace(input.TransferID), strings.TrimSpace(input.StatementRowID), strings.TrimSpace(input.ActorID)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || boundedText(input.TransferID, 1, 128) == "" || boundedText(input.StatementRowID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("transfer-reconciled", input.TransferID, input.StatementRowID, input.ActorID)
	if found, payoutID, _, err := existingPayoutAudit(ctx, tx, "TRANSFER_RECONCILED", input.IdempotencyKey, hash); err != nil {
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
	var actorType, actorID string
	err = tx.QueryRowContext(ctx, `SELECT p.actor_type,p.actor_id FROM wlt.manual_transfer_executions t JOIN wlt.payout_requests p ON p.id=t.payout_id WHERE t.id=$1`, input.TransferID).Scan(&actorType, &actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	}
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if actorType == "captain" {
		if err := lockCaptainWalletBalance(ctx, tx, actorID); err != nil {
			return ManualTransferExecutionRecord{}, err
		}
	}
	var transfer ManualTransferExecutionRecord
	if err := scanManualTransfer(ctx, tx, input.TransferID, true, &transfer); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if transfer.ExecutionStatus != "VERIFIED" {
		return ManualTransferExecutionRecord{}, ErrTransferState
	}
	var statementProvider, statementCurrency, statementReference, statementDestinationCiphertext, destinationCiphertext string
	var statementAmount int64
	var matchedTransferID sql.NullString
	var statementBatchID sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT s.provider_key,s.batch_id,r.external_transfer_reference,r.amount_minor,r.currency,r.destination_identifier_ciphertext,r.matched_transfer_id,d.wallet_identifier_ciphertext FROM wlt.settlement_statement_rows r JOIN wlt.settlement_statements s ON s.id=r.statement_id JOIN wlt.official_wallet_destinations d ON d.id=$2 WHERE r.id=$1 FOR UPDATE OF r`, input.StatementRowID, transfer.DestinationID).Scan(&statementProvider, &statementBatchID, &statementReference, &statementAmount, &statementCurrency, &statementDestinationCiphertext, &matchedTransferID, &destinationCiphertext); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	statementDestination, err := cipher.decrypt(statementDestinationCiphertext)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	approvedDestination, err := cipher.decrypt(destinationCiphertext)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if transfer.ExecutedBy == input.ActorID {
		return ManualTransferExecutionRecord{}, ErrTransferSeparation
	}
	if matchedTransferID.Valid || (statementBatchID.Valid && statementBatchID.String != transfer.BatchID) || statementProvider != transfer.ProviderKey || statementReference != transfer.ExternalReference || statementAmount != transfer.AmountMinor || statementCurrency != transfer.Currency || statementDestination != approvedDestination {
		return ManualTransferExecutionRecord{}, ErrTransferState
	}
	accountCode := walletAccountCodeForTransfer(ctx, tx, transfer.PayoutID)
	if actorType == "customer" {
		if err := lockCustomerWalletBalance(ctx, tx, actorID); err != nil {
			return ManualTransferExecutionRecord{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'PAYOUT_COMPLETED','MANUAL_EXTERNAL_TRANSFER',$2,$3,$4,$5,$6)`, mustNewID("ledger"), transfer.PayoutID, transfer.Currency, "payout-completion-"+transfer.PayoutID, hash, input.CorrelationID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	var ledgerID string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.ledger_transactions WHERE source_type='MANUAL_EXTERNAL_TRANSFER' AND source_id=$1", transfer.PayoutID).Scan(&ledgerID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'liability',$2,$3,$4,'DEBIT',$5,$6),($1,2,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'CREDIT',$5,$6)`, ledgerID, accountCode, actorType, actorID, transfer.AmountMinor, transfer.Currency); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='COMPLETED',ledger_transaction_id=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='EXECUTED'", transfer.PayoutID, ledgerID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	var customerIntakeID string
	intakeErr := tx.QueryRowContext(ctx, "SELECT id FROM wlt.customer_manual_withdrawal_intakes WHERE payout_id=$1 FOR UPDATE", transfer.PayoutID).Scan(&customerIntakeID)
	if intakeErr == nil {
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.customer_manual_withdrawal_intakes SET status='COMPLETED' WHERE id=$1 AND status='PAYOUT_HELD'", customerIntakeID); err != nil {
			return ManualTransferExecutionRecord{}, err
		}
		completionKey := "customer-withdrawal-completed:" + transfer.PayoutID
		completionHash := hashFacts("customer-withdrawal-completed", customerIntakeID, transfer.PayoutID, input.ActorID, input.StatementRowID)
		if err := insertCustomerWithdrawalEvent(ctx, tx, customerIntakeID, "PAYOUT_COMPLETED", input.ActorID, "provider statement reconciled", "", transfer.PayoutID, completionKey, completionHash, input.CorrelationID); err != nil {
			return ManualTransferExecutionRecord{}, err
		}
	} else if !errors.Is(intakeErr, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, intakeErr
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_holds SET status='FINALIZED',released_at=clock_timestamp() WHERE payout_id=$1 AND status='ACTIVE'", transfer.PayoutID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_statement_rows SET matched_transfer_id=$2,matched_by=$3,matched_at=clock_timestamp() WHERE id=$1 AND matched_transfer_id IS NULL", input.StatementRowID, input.TransferID, input.ActorID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.manual_transfer_executions SET execution_status='RECONCILED',statement_row_id=$2,reconciled_by=$3,reconciled_at=clock_timestamp() WHERE id=$1 AND execution_status='VERIFIED'", input.TransferID, input.StatementRowID, input.ActorID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_batches SET status=CASE WHEN (SELECT COUNT(*) FROM wlt.payout_requests p JOIN wlt.settlement_batch_items i ON i.payout_id=p.id WHERE i.batch_id=$1 AND p.status='COMPLETED')=row_count THEN 'COMPLETED' ELSE 'AWAITING_RECONCILIATION' END,updated_at=clock_timestamp() WHERE id=$1", transfer.BatchID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "TRANSFER_RECONCILED", transfer.PayoutID, transfer.BatchID, input.ActorID, "", input.StatementRowID, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "PAYOUT_COMPLETED", transfer.PayoutID, transfer.BatchID, input.ActorID, "", input.StatementRowID, input.IdempotencyKey+"-completed", hashFacts("payout-completed", hash), input.CorrelationID); err != nil {
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
