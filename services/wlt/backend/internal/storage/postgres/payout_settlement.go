package postgres

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"
)

var (
	ErrPayoutNotFound           = errors.New("payout request was not found")
	ErrPayoutState              = errors.New("payout request state does not allow this operation")
	ErrPayoutApprovalSeparation = errors.New("payout approval must be performed by a different operator")
	ErrSettlementBatchNotFound  = errors.New("settlement batch was not found")
	ErrSettlementBatchState     = errors.New("settlement batch state does not allow this operation")
	ErrSettlementBatchInput     = errors.New("settlement batch input is invalid")
	ErrTransferNotFound         = errors.New("manual transfer execution was not found")
	ErrTransferState            = errors.New("manual transfer state does not allow this operation")
	ErrTransferSeparation       = errors.New("transfer verification must be performed by a different operator")
)

type PayoutSnapshotRecord struct {
	PayoutID            string
	ActorType           string
	ActorID             string
	BeneficiaryName     string
	ProviderKey         string
	MaskedDestination   string
	DestinationID       string
	DestinationVersion  int
	AmountMode          string
	ResolvedAmountMinor int64
	Currency            string
	PolicyVersion       string
	SnapshotHash        string
	PreparedBy          string
	PreparedAt          time.Time
	ApprovedBy          *string
	ApprovedAt          *time.Time
}

type SettlementBatchRecord struct {
	ID               string
	ProviderKey      string
	Currency         string
	Status           string
	RowCount         int
	TotalAmountMinor int64
	CreatedBy        string
	CreatedAt        time.Time
	ApprovedBy       *string
	ApprovedAt       *time.Time
	FrozenBy         *string
	FrozenAt         *time.Time
	BatchHash        string
}

type ManualTransferExecutionRecord struct {
	ID                   string
	BatchID              string
	PayoutID             string
	ApprovedSnapshotHash string
	ExecutedBy           string
	ExecutedAt           time.Time
	ProviderKey          string
	ExternalReference    string
	AmountMinor          int64
	Currency             string
	DestinationID        string
	DestinationVersion   int
	EvidenceReference    string
	ExecutionStatus      string
	VerifiedBy           *string
	VerifiedAt           *time.Time
	StatementReference   *string
	ReconciledBy         *string
	ReconciledAt         *time.Time
}

type PreparePayoutInput struct {
	PayoutID       string
	ActorID        string
	Reason         string
	Evidence       string
	IdempotencyKey string
	CorrelationID  string
}

type ApprovePayoutInput struct {
	PayoutID       string
	ActorID        string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

type CancelPayoutInput struct {
	PayoutID       string
	ActorID        string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

type CreateSettlementBatchInput struct {
	PayoutIDs      []string
	ActorID        string
	IdempotencyKey string
	CorrelationID  string
}

type BatchActionInput struct {
	BatchID        string
	ActorID        string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

type RecordTransferInput struct {
	BatchID           string
	PayoutID          string
	ActorID           string
	ExternalReference string
	EvidenceReference string
	IdempotencyKey    string
	CorrelationID     string
}

type VerifyTransferInput struct {
	TransferID     string
	ActorID        string
	Evidence       string
	IdempotencyKey string
	CorrelationID  string
}

type ReconcileTransferInput struct {
	TransferID         string
	ActorID            string
	StatementReference string
	IdempotencyKey     string
	CorrelationID      string
}

func ListPayoutRequests(ctx context.Context, db *sql.DB, status string, limit int) ([]PayoutRequestRecord, error) {
	if db == nil {
		return nil, ErrPayoutInvalidInput
	}
	status = strings.ToUpper(strings.TrimSpace(status))
	if status != "" && !validPayoutStatus(status) {
		return nil, ErrPayoutInvalidInput
	}
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	query := "SELECT id FROM wlt.payout_requests"
	args := []any{}
	if status != "" {
		query += " WHERE status=$1"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC LIMIT $" + formatInt(len(args)+1)
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]PayoutRequestRecord, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		item, err := ReadPayoutRequest(ctx, db, id)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func PreparePayout(ctx context.Context, db *sql.DB, input PreparePayoutInput) (PayoutRequestRecord, error) {
	input.PayoutID, input.ActorID = strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.Reason, input.Evidence = strings.TrimSpace(input.Reason), strings.TrimSpace(input.Evidence)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.Reason, 1, 512) == "" || boundedText(input.Evidence, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("payout-prepare", input.PayoutID, input.ActorID, input.Reason, input.Evidence)
	if found, payoutID, _, err := existingPayoutAudit(ctx, tx, "PAYOUT_PREPARED", input.IdempotencyKey, hash); err != nil {
		return PayoutRequestRecord{}, err
	} else if found {
		item, err := readPayoutRequest(ctx, tx, payoutID)
		if err != nil {
			return PayoutRequestRecord{}, err
		}
		if err := tx.Commit(); err != nil {
			return PayoutRequestRecord{}, err
		}
		return item, nil
	}
	var actorType, actorID, destinationID, status string
	var destinationVersion int
	if err := tx.QueryRowContext(ctx, "SELECT actor_type,actor_id,destination_id,destination_version,status FROM wlt.payout_requests WHERE id=$1 FOR UPDATE", input.PayoutID).Scan(&actorType, &actorID, &destinationID, &destinationVersion, &status); errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, ErrPayoutNotFound
	} else if err != nil {
		return PayoutRequestRecord{}, err
	}
	if status != "HELD" {
		return PayoutRequestRecord{}, ErrPayoutState
	}
	destination, err := readOfficialWalletDestination(ctx, tx, destinationID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	snapshotHash := hashFacts("approved-payout-snapshot", input.PayoutID, actorType, actorID, destination.BeneficiaryName, destination.ProviderKey, destination.WalletIdentifierMasked, destination.ID, formatInt(destinationVersion), status)
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.approved_payout_snapshots(payout_id,actor_type,actor_id,beneficiary_name,provider_key,masked_destination,destination_id,destination_version,amount_mode,resolved_amount_minor,currency,policy_version,snapshot_hash,prepared_by) SELECT id,actor_type,actor_id,$2,$3,$4,destination_id,destination_version,amount_mode,resolved_amount_minor,currency,policy_version,$5,$6 FROM wlt.payout_requests WHERE id=$1`, input.PayoutID, destination.BeneficiaryName, destination.ProviderKey, destination.WalletIdentifierMasked, snapshotHash, input.ActorID); err != nil {
		return PayoutRequestRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='PREPARED',updated_at=clock_timestamp() WHERE id=$1", input.PayoutID); err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "PAYOUT_PREPARED", input.PayoutID, "", input.ActorID, input.Reason, input.Evidence, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return PayoutRequestRecord{}, err
	}
	item, err := readPayoutRequest(ctx, tx, input.PayoutID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return PayoutRequestRecord{}, err
	}
	return item, nil
}

func ApprovePayout(ctx context.Context, db *sql.DB, input ApprovePayoutInput) (PayoutRequestRecord, error) {
	input.PayoutID, input.ActorID = strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.Reason, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.Reason), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.Reason, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	return transitionPayout(ctx, db, "PAYOUT_APPROVED", input.PayoutID, input.ActorID, input.Reason, "", input.IdempotencyKey, input.CorrelationID, func(tx *sql.Tx, payout PayoutRequestRecord) error {
		if payout.Status != "PREPARED" {
			return ErrPayoutState
		}
		var preparedBy string
		if err := tx.QueryRowContext(ctx, "SELECT prepared_by FROM wlt.approved_payout_snapshots WHERE payout_id=$1 FOR UPDATE", input.PayoutID).Scan(&preparedBy); err != nil {
			return err
		}
		if preparedBy == input.ActorID {
			return ErrPayoutApprovalSeparation
		}
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.approved_payout_snapshots SET approved_by=$2,approved_at=clock_timestamp() WHERE payout_id=$1", input.PayoutID, input.ActorID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='APPROVED',updated_at=clock_timestamp() WHERE id=$1", input.PayoutID)
		return err
	})
}

func CancelPayout(ctx context.Context, db *sql.DB, input CancelPayoutInput) (PayoutRequestRecord, error) {
	input.PayoutID, input.ActorID = strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.Reason, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.Reason), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.Reason, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	return transitionPayout(ctx, db, "PAYOUT_CANCELLED", input.PayoutID, input.ActorID, input.Reason, "", input.IdempotencyKey, input.CorrelationID, func(tx *sql.Tx, payout PayoutRequestRecord) error {
		if payout.Status != "HELD" && payout.Status != "PREPARED" {
			return ErrPayoutState
		}
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_holds SET status='RELEASED',released_at=clock_timestamp() WHERE payout_id=$1 AND status='ACTIVE'", input.PayoutID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=$1", input.PayoutID)
		return err
	})
}

func transitionPayout(ctx context.Context, db *sql.DB, eventType, payoutID, actorID, reason, evidence, idempotencyKey, correlationID string, apply func(*sql.Tx, PayoutRequestRecord) error) (PayoutRequestRecord, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts(strings.ToLower(eventType), payoutID, actorID, reason, evidence)
	if found, existingID, _, err := existingPayoutAudit(ctx, tx, eventType, idempotencyKey, hash); err != nil {
		return PayoutRequestRecord{}, err
	} else if found {
		item, err := readPayoutRequest(ctx, tx, existingID)
		if err != nil {
			return PayoutRequestRecord{}, err
		}
		if err := tx.Commit(); err != nil {
			return PayoutRequestRecord{}, err
		}
		return item, nil
	}
	payout, err := readPayoutForUpdate(ctx, tx, payoutID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := apply(tx, payout); err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, eventType, payoutID, "", actorID, reason, evidence, idempotencyKey, hash, correlationID); err != nil {
		return PayoutRequestRecord{}, err
	}
	item, err := readPayoutRequest(ctx, tx, payoutID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return PayoutRequestRecord{}, err
	}
	return item, nil
}

func CreateSettlementBatch(ctx context.Context, db *sql.DB, input CreateSettlementBatchInput) (SettlementBatchRecord, error) {
	input.ActorID, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.ActorID), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	ids := make([]string, 0, len(input.PayoutIDs))
	seen := map[string]bool{}
	for _, id := range input.PayoutIDs {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if db == nil || boundedText(input.ActorID, 1, 128) == "" || len(ids) == 0 || len(ids) > 100 || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return SettlementBatchRecord{}, ErrSettlementBatchInput
	}
	hashParts := []string{"settlement-batch"}
	hashParts = append(hashParts, ids...)
	hash := hashFacts(hashParts...)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if found, _, batchID, err := existingPayoutAudit(ctx, tx, "BATCH_CREATED", input.IdempotencyKey, hash); err != nil {
		return SettlementBatchRecord{}, err
	} else if found {
		item, err := readSettlementBatch(ctx, tx, batchID)
		if err != nil {
			return SettlementBatchRecord{}, err
		}
		if err := tx.Commit(); err != nil {
			return SettlementBatchRecord{}, err
		}
		return item, nil
	}
	var provider, currency string
	var total int64
	for index, payoutID := range ids {
		payout, err := readPayoutForUpdate(ctx, tx, payoutID)
		if err != nil {
			return SettlementBatchRecord{}, err
		}
		if payout.Status != "APPROVED" {
			return SettlementBatchRecord{}, ErrPayoutState
		}
		var snapshot PayoutSnapshotRecord
		if err := scanPayoutSnapshot(ctx, tx, payoutID, &snapshot); err != nil {
			return SettlementBatchRecord{}, err
		}
		if index == 0 {
			provider, currency = snapshot.ProviderKey, snapshot.Currency
		} else if snapshot.ProviderKey != provider || snapshot.Currency != currency {
			return SettlementBatchRecord{}, ErrSettlementBatchInput
		}
		total += snapshot.ResolvedAmountMinor
		if index == 0 {
			hashParts = append(hashParts, provider, currency)
		}
		hashParts = append(hashParts, snapshot.SnapshotHash, formatInt64(snapshot.ResolvedAmountMinor))
	}
	batchID, err := newID("settlement_batch")
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.settlement_batches(id,provider_key,currency,status,row_count,total_amount_minor,created_by,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,'PREPARED',$4,$5,$6,$7,$8,$9)`, batchID, provider, currency, len(ids), total, input.ActorID, input.IdempotencyKey, hashFacts(hashParts...), input.CorrelationID); err != nil {
		return SettlementBatchRecord{}, err
	}
	for index, payoutID := range ids {
		var snapshotHash, destinationID string
		var amount int64
		var destinationVersion int
		if err := tx.QueryRowContext(ctx, "SELECT snapshot_hash,resolved_amount_minor,destination_id,destination_version FROM wlt.approved_payout_snapshots WHERE payout_id=$1", payoutID).Scan(&snapshotHash, &amount, &destinationID, &destinationVersion); err != nil {
			return SettlementBatchRecord{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.settlement_batch_items(batch_id,payout_id,row_sequence,snapshot_hash,amount_minor,destination_id,destination_version) VALUES($1,$2,$3,$4,$5,$6,$7)`, batchID, payoutID, index+1, snapshotHash, amount, destinationID, destinationVersion); err != nil {
			return SettlementBatchRecord{}, err
		}
	}
	if err := insertPayoutAudit(ctx, tx, "BATCH_CREATED", "", batchID, input.ActorID, "", "", input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return SettlementBatchRecord{}, err
	}
	item, err := readSettlementBatch(ctx, tx, batchID)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return SettlementBatchRecord{}, err
	}
	return item, nil
}

func ApproveSettlementBatch(ctx context.Context, db *sql.DB, input BatchActionInput) (SettlementBatchRecord, error) {
	return transitionBatch(ctx, db, "BATCH_APPROVED", input, "PREPARED", func(tx *sql.Tx, batch SettlementBatchRecord) error {
		if batch.CreatedBy == input.ActorID {
			return ErrPayoutApprovalSeparation
		}
		_, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_batches SET status='APPROVED',approved_by=$2,approved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", input.BatchID, input.ActorID)
		return err
	})
}

func FreezeSettlementBatch(ctx context.Context, db *sql.DB, input BatchActionInput) (SettlementBatchRecord, error) {
	return transitionBatch(ctx, db, "BATCH_FROZEN", input, "APPROVED", func(tx *sql.Tx, batch SettlementBatchRecord) error {
		if batch.ApprovedBy != nil && *batch.ApprovedBy == input.ActorID {
			return ErrPayoutApprovalSeparation
		}
		rows, err := tx.QueryContext(ctx, "SELECT payout_id,snapshot_hash,amount_minor,destination_id,destination_version FROM wlt.settlement_batch_items WHERE batch_id=$1 ORDER BY row_sequence", input.BatchID)
		if err != nil {
			return err
		}
		defer rows.Close()
		parts := []string{"settlement-batch-frozen", input.BatchID, batch.ProviderKey, batch.Currency}
		payoutIDs := make([]string, 0, batch.RowCount)
		for rows.Next() {
			var payoutID, snapshotHash, destinationID string
			var amount int64
			var version int
			if err := rows.Scan(&payoutID, &snapshotHash, &amount, &destinationID, &version); err != nil {
				return err
			}
			parts = append(parts, payoutID, snapshotHash, formatInt64(amount), destinationID, formatInt(version))
			payoutIDs = append(payoutIDs, payoutID)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		batchHash := hashFacts(parts...)
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_batches SET status='FROZEN',frozen_by=$2,frozen_at=clock_timestamp(),batch_hash=$3,updated_at=clock_timestamp() WHERE id=$1", input.BatchID, input.ActorID, batchHash); err != nil {
			return err
		}
		for _, payoutID := range payoutIDs {
			if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='FROZEN',updated_at=clock_timestamp() WHERE id=$1 AND status='APPROVED'", payoutID); err != nil {
				return err
			}
		}
		return nil
	})
}

func transitionBatch(ctx context.Context, db *sql.DB, eventType string, input BatchActionInput, requiredStatus string, apply func(*sql.Tx, SettlementBatchRecord) error) (SettlementBatchRecord, error) {
	input.BatchID, input.ActorID, input.Reason, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.BatchID), strings.TrimSpace(input.ActorID), strings.TrimSpace(input.Reason), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.BatchID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || (eventType == "BATCH_APPROVED" && boundedText(input.Reason, 1, 512) == "") || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return SettlementBatchRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts(strings.ToLower(eventType), input.BatchID, input.ActorID, input.Reason)
	if found, _, batchID, err := existingPayoutAudit(ctx, tx, eventType, input.IdempotencyKey, hash); err != nil {
		return SettlementBatchRecord{}, err
	} else if found {
		item, err := readSettlementBatch(ctx, tx, batchID)
		if err != nil {
			return SettlementBatchRecord{}, err
		}
		if err := tx.Commit(); err != nil {
			return SettlementBatchRecord{}, err
		}
		return item, nil
	}
	var batch SettlementBatchRecord
	if err := scanSettlementBatch(ctx, tx, input.BatchID, true, &batch); errors.Is(err, sql.ErrNoRows) {
		return SettlementBatchRecord{}, ErrSettlementBatchNotFound
	} else if err != nil {
		return SettlementBatchRecord{}, err
	}
	if batch.Status != requiredStatus {
		return SettlementBatchRecord{}, ErrSettlementBatchState
	}
	if err := apply(tx, batch); err != nil {
		return SettlementBatchRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, eventType, "", input.BatchID, input.ActorID, input.Reason, "", input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return SettlementBatchRecord{}, err
	}
	item, err := readSettlementBatch(ctx, tx, input.BatchID)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return SettlementBatchRecord{}, err
	}
	return item, nil
}

func RecordManualTransfer(ctx context.Context, db *sql.DB, input RecordTransferInput) (ManualTransferExecutionRecord, error) {
	input.BatchID, input.PayoutID, input.ActorID = strings.TrimSpace(input.BatchID), strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.ExternalReference, input.EvidenceReference = strings.TrimSpace(input.ExternalReference), strings.TrimSpace(input.EvidenceReference)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.BatchID, 1, 128) == "" || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.ExternalReference, 1, 160) == "" || boundedText(input.EvidenceReference, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("transfer-executed", input.BatchID, input.PayoutID, input.ActorID, input.ExternalReference, input.EvidenceReference)
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.manual_transfer_executions(id,batch_id,payout_id,approved_snapshot_hash,executed_by,provider_key,external_transfer_reference,amount_minor,currency,destination_id,destination_version,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, transferID, input.BatchID, input.PayoutID, snapshotHash, input.ActorID, providerKey, input.ExternalReference, amount, currency, destinationID, version, input.EvidenceReference); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='EXECUTED',updated_at=clock_timestamp() WHERE id=$1", input.PayoutID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_batches SET status=CASE WHEN (SELECT COUNT(*) FROM wlt.manual_transfer_executions WHERE batch_id=$1)=row_count THEN 'AWAITING_VERIFICATION' ELSE 'EXECUTION_IN_PROGRESS' END,updated_at=clock_timestamp() WHERE id=$1", input.BatchID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "TRANSFER_EXECUTED", input.PayoutID, input.BatchID, input.ActorID, "", input.EvidenceReference, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
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
	input.TransferID, input.ActorID, input.Evidence = strings.TrimSpace(input.TransferID), strings.TrimSpace(input.ActorID), strings.TrimSpace(input.Evidence)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.TransferID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("transfer-verified", input.TransferID, input.ActorID, input.Evidence)
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
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_batches SET status=CASE WHEN (SELECT COUNT(*) FROM manual_transfer_executions WHERE batch_id=$1 AND execution_status='VERIFIED')=row_count THEN 'AWAITING_RECONCILIATION' ELSE 'AWAITING_VERIFICATION' END,updated_at=clock_timestamp() WHERE id=$1", transfer.BatchID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "TRANSFER_VERIFIED", transfer.PayoutID, transfer.BatchID, input.ActorID, "", input.Evidence, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
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

func ReconcileManualTransfer(ctx context.Context, db *sql.DB, input ReconcileTransferInput) (ManualTransferExecutionRecord, error) {
	input.TransferID, input.ActorID, input.StatementReference = strings.TrimSpace(input.TransferID), strings.TrimSpace(input.ActorID), strings.TrimSpace(input.StatementReference)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.TransferID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.StatementReference, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return ManualTransferExecutionRecord{}, ErrSettlementBatchInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("transfer-reconciled", input.TransferID, input.ActorID, input.StatementReference)
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
	var transfer ManualTransferExecutionRecord
	if err := scanManualTransfer(ctx, tx, input.TransferID, true, &transfer); errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	} else if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if transfer.ExecutionStatus != "VERIFIED" {
		return ManualTransferExecutionRecord{}, ErrTransferState
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'PAYOUT_COMPLETED','MANUAL_EXTERNAL_TRANSFER',$2,$3,$4,$5,$6)`, mustNewID("ledger"), transfer.PayoutID, transfer.Currency, "payout-completion-"+transfer.PayoutID, hash, input.CorrelationID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	var ledgerID string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.ledger_transactions WHERE source_type='MANUAL_EXTERNAL_TRANSFER' AND source_id=$1", transfer.PayoutID).Scan(&ledgerID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	accountCode := walletAccountCodeForTransfer(ctx, tx, transfer.PayoutID)
	actorType, actorID, err := payoutActor(ctx, tx, transfer.PayoutID)
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'liability',$2,$3,$4,'DEBIT',$5,$6),($1,2,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'CREDIT',$5,$6)`, ledgerID, accountCode, actorType, actorID, transfer.AmountMinor, transfer.Currency); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_requests SET status='COMPLETED',ledger_transaction_id=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='EXECUTED'", transfer.PayoutID, ledgerID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.payout_holds SET status='FINALIZED',released_at=clock_timestamp() WHERE payout_id=$1 AND status='ACTIVE'", transfer.PayoutID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.manual_transfer_executions SET execution_status='RECONCILED',statement_reference=$2,reconciled_by=$3,reconciled_at=clock_timestamp() WHERE id=$1", input.TransferID, input.StatementReference, input.ActorID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.settlement_batches SET status=CASE WHEN (SELECT COUNT(*) FROM wlt.payout_requests p JOIN wlt.settlement_batch_items i ON i.payout_id=p.id WHERE i.batch_id=$1 AND p.status='COMPLETED')=row_count THEN 'COMPLETED' ELSE 'AWAITING_RECONCILIATION' END,updated_at=clock_timestamp() WHERE id=$1", transfer.BatchID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "TRANSFER_RECONCILED", transfer.PayoutID, transfer.BatchID, input.ActorID, "", input.StatementReference, input.IdempotencyKey, hash, input.CorrelationID); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "PAYOUT_COMPLETED", transfer.PayoutID, transfer.BatchID, input.ActorID, "", input.StatementReference, input.IdempotencyKey+"-completed", hashFacts("payout-completed", hash), input.CorrelationID); err != nil {
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

func readPayoutForUpdate(ctx context.Context, tx *sql.Tx, payoutID string) (PayoutRequestRecord, error) {
	var id string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.payout_requests WHERE id=$1 FOR UPDATE", payoutID).Scan(&id); errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, ErrPayoutNotFound
	} else if err != nil {
		return PayoutRequestRecord{}, err
	}
	return readPayoutRequest(ctx, tx, payoutID)
}

func validMutationContext(idempotencyKey, correlationID string) bool {
	return len(idempotencyKey) >= 8 && len(idempotencyKey) <= 128 && len(correlationID) >= 8 && len(correlationID) <= 128
}

func validPayoutStatus(status string) bool {
	switch status {
	case "HELD", "CANCELLED", "PREPARED", "APPROVED", "FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION":
		return true
	default:
		return false
	}
}

func existingPayoutAudit(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, requestHash string) (bool, string, string, error) {
	var existingType, existingHash string
	var payoutID, batchID sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT event_type,request_hash,payout_id,batch_id FROM wlt.payout_audit_events WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&existingType, &existingHash, &payoutID, &batchID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, "", "", nil
	}
	if err != nil {
		return false, "", "", err
	}
	if existingType != eventType || existingHash != requestHash {
		return false, "", "", ErrIdempotencyConflict
	}
	return true, payoutID.String, batchID.String, nil
}

func insertPayoutAudit(ctx context.Context, tx *sql.Tx, eventType, payoutID, batchID, actorID, reason, evidence, idempotencyKey, requestHash, correlationID string) error {
	id, err := newID("payout_audit")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.payout_audit_events(id,event_type,payout_id,batch_id,actor_id,reason,evidence_reference,idempotency_key,request_hash,correlation_id) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10)`, id, eventType, payoutID, batchID, actorID, reason, evidence, idempotencyKey, requestHash, correlationID)
	return err
}

func scanPayoutSnapshot(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, payoutID string, item *PayoutSnapshotRecord) error {
	var approvedBy sql.NullString
	var approvedAt sql.NullTime
	err := source.QueryRowContext(ctx, `SELECT payout_id,actor_type,actor_id,beneficiary_name,provider_key,masked_destination,destination_id,destination_version,amount_mode,resolved_amount_minor,currency,policy_version,snapshot_hash,prepared_by,prepared_at,approved_by,approved_at FROM wlt.approved_payout_snapshots WHERE payout_id=$1`, payoutID).Scan(&item.PayoutID, &item.ActorType, &item.ActorID, &item.BeneficiaryName, &item.ProviderKey, &item.MaskedDestination, &item.DestinationID, &item.DestinationVersion, &item.AmountMode, &item.ResolvedAmountMinor, &item.Currency, &item.PolicyVersion, &item.SnapshotHash, &item.PreparedBy, &item.PreparedAt, &approvedBy, &approvedAt)
	if approvedBy.Valid {
		item.ApprovedBy = &approvedBy.String
	}
	if approvedAt.Valid {
		item.ApprovedAt = &approvedAt.Time
	}
	return err
}

func scanSettlementBatch(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, batchID string, forUpdate bool, item *SettlementBatchRecord) error {
	query := `SELECT id,provider_key,currency,status,row_count,total_amount_minor,created_by,created_at,approved_by,approved_at,frozen_by,frozen_at,COALESCE(batch_hash,'') FROM wlt.settlement_batches WHERE id=$1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	var approvedBy, frozenBy sql.NullString
	var approvedAt, frozenAt sql.NullTime
	err := source.QueryRowContext(ctx, query, batchID).Scan(&item.ID, &item.ProviderKey, &item.Currency, &item.Status, &item.RowCount, &item.TotalAmountMinor, &item.CreatedBy, &item.CreatedAt, &approvedBy, &approvedAt, &frozenBy, &frozenAt, &item.BatchHash)
	if approvedBy.Valid {
		item.ApprovedBy = &approvedBy.String
	}
	if approvedAt.Valid {
		item.ApprovedAt = &approvedAt.Time
	}
	if frozenBy.Valid {
		item.FrozenBy = &frozenBy.String
	}
	if frozenAt.Valid {
		item.FrozenAt = &frozenAt.Time
	}
	return err
}

func readSettlementBatch(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, batchID string) (SettlementBatchRecord, error) {
	var item SettlementBatchRecord
	err := scanSettlementBatch(ctx, source, batchID, false, &item)
	if errors.Is(err, sql.ErrNoRows) {
		return SettlementBatchRecord{}, ErrSettlementBatchNotFound
	}
	return item, err
}

func ReadSettlementBatch(ctx context.Context, db *sql.DB, batchID string) (SettlementBatchRecord, error) {
	batchID = strings.TrimSpace(batchID)
	if db == nil || boundedText(batchID, 1, 128) == "" {
		return SettlementBatchRecord{}, ErrSettlementBatchInput
	}
	return readSettlementBatch(ctx, db, batchID)
}

func scanManualTransfer(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, transferID string, forUpdate bool, item *ManualTransferExecutionRecord) error {
	query := `SELECT id,batch_id,payout_id,approved_snapshot_hash,executed_by,executed_at,provider_key,external_transfer_reference,amount_minor,currency,destination_id,destination_version,evidence_reference,execution_status,verified_by,verified_at,statement_reference,reconciled_by,reconciled_at FROM wlt.manual_transfer_executions WHERE id=$1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	var verifiedBy, statementReference, reconciledBy sql.NullString
	var verifiedAt, reconciledAt sql.NullTime
	err := source.QueryRowContext(ctx, query, transferID).Scan(&item.ID, &item.BatchID, &item.PayoutID, &item.ApprovedSnapshotHash, &item.ExecutedBy, &item.ExecutedAt, &item.ProviderKey, &item.ExternalReference, &item.AmountMinor, &item.Currency, &item.DestinationID, &item.DestinationVersion, &item.EvidenceReference, &item.ExecutionStatus, &verifiedBy, &verifiedAt, &statementReference, &reconciledBy, &reconciledAt)
	if verifiedBy.Valid {
		item.VerifiedBy = &verifiedBy.String
	}
	if verifiedAt.Valid {
		item.VerifiedAt = &verifiedAt.Time
	}
	if statementReference.Valid {
		item.StatementReference = &statementReference.String
	}
	if reconciledBy.Valid {
		item.ReconciledBy = &reconciledBy.String
	}
	if reconciledAt.Valid {
		item.ReconciledAt = &reconciledAt.Time
	}
	return err
}

func readManualTransfer(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, payoutID string) (ManualTransferExecutionRecord, error) {
	var item ManualTransferExecutionRecord
	err := source.QueryRowContext(ctx, "SELECT id FROM wlt.manual_transfer_executions WHERE payout_id=$1", payoutID).Scan(&item.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	}
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := scanManualTransfer(ctx, source, item.ID, false, &item); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	return item, nil
}

func payoutActor(ctx context.Context, tx *sql.Tx, payoutID string) (string, string, error) {
	var actorType, actorID string
	err := tx.QueryRowContext(ctx, "SELECT actor_type,actor_id FROM wlt.payout_requests WHERE id=$1", payoutID).Scan(&actorType, &actorID)
	return actorType, actorID, err
}

func walletAccountCodeForTransfer(ctx context.Context, tx *sql.Tx, payoutID string) string {
	actorType, _, err := payoutActor(ctx, tx, payoutID)
	if err != nil {
		return ""
	}
	return walletAccountCode(actorType)
}

func mustNewID(prefix string) string {
	id, err := newID(prefix)
	if err != nil {
		return prefix + "-invalid"
	}
	return id
}
