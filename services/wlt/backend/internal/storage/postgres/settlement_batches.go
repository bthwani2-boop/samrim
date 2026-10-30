package postgres

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
)

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
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var provider, currency string
	var total int64
	snapshots := make([]PayoutSnapshotRecord, 0, len(ids))
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
		snapshots = append(snapshots, snapshot)
		if index == 0 {
			provider, currency = snapshot.ProviderKey, snapshot.Currency
		} else if snapshot.ProviderKey != provider || snapshot.Currency != currency {
			return SettlementBatchRecord{}, ErrSettlementBatchInput
		}
		total += snapshot.ResolvedAmountMinor
	}
	factHashes, err := requireIdentityFactsForSnapshots(ctx, tx, input.DestinationCipher, input.IdentityFactsByBeneficiary, snapshots)
	if err != nil {
		return SettlementBatchRecord{}, commitIdentityStaleness(tx, err)
	}
	hashParts := []string{"settlement-batch", provider, currency}
	hashParts = append(hashParts, ids...)
	for _, snapshot := range snapshots {
		hashParts = append(hashParts, snapshot.SnapshotHash, formatInt64(snapshot.ResolvedAmountMinor))
	}
	hashParts = append(hashParts, factHashes...)
	hash := hashFacts(hashParts...)
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
	var batch SettlementBatchRecord
	if err := scanSettlementBatch(ctx, tx, input.BatchID, true, &batch); errors.Is(err, sql.ErrNoRows) {
		return SettlementBatchRecord{}, ErrSettlementBatchNotFound
	} else if err != nil {
		return SettlementBatchRecord{}, err
	}
	snapshots, err := readSettlementBatchSnapshots(ctx, tx, input.BatchID)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	factHashes, err := requireIdentityFactsForSnapshots(ctx, tx, input.DestinationCipher, input.IdentityFactsByBeneficiary, snapshots)
	if err != nil {
		return SettlementBatchRecord{}, commitIdentityStaleness(tx, err)
	}
	hashParts := []string{strings.ToLower(eventType), input.BatchID, input.ActorID, input.Reason}
	hashParts = append(hashParts, factHashes...)
	hash := hashFacts(hashParts...)
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

func readSettlementBatchSnapshots(ctx context.Context, source interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, batchID string) ([]PayoutSnapshotRecord, error) {
	rows, err := source.QueryContext(ctx, `SELECT payout_id FROM wlt.settlement_batch_items WHERE batch_id=$1 ORDER BY row_sequence`, batchID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	snapshots := make([]PayoutSnapshotRecord, 0, len(ids))
	for _, id := range ids {
		var snapshot PayoutSnapshotRecord
		if err := scanPayoutSnapshot(ctx, source, id, &snapshot); err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func requireIdentityFactsForSnapshots(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, cipher *DestinationCipher, factsList []IdentityFacts, snapshots []PayoutSnapshotRecord) ([]string, error) {
	if cipher == nil || len(snapshots) == 0 || len(factsList) == 0 {
		return nil, ErrReverificationRequired
	}
	type beneficiaryKey struct{ actorType, actorID string }
	required := make(map[beneficiaryKey][]PayoutSnapshotRecord)
	for _, snapshot := range snapshots {
		key := beneficiaryKey{actorType: strings.ToLower(strings.TrimSpace(snapshot.ActorType)), actorID: strings.TrimSpace(snapshot.ActorID)}
		if key.actorType == "" || key.actorID == "" {
			return nil, ErrReverificationRequired
		}
		for _, prior := range required[key] {
			if prior.DestinationID != snapshot.DestinationID || prior.DestinationVersion != snapshot.DestinationVersion ||
				prior.BeneficiaryName != snapshot.BeneficiaryName || prior.BeneficiaryIdentityVersion != snapshot.BeneficiaryIdentityVersion {
				return nil, ErrReverificationRequired
			}
		}
		required[key] = append(required[key], snapshot)
	}
	orderedKeys := make([]beneficiaryKey, 0, len(required))
	for key := range required {
		orderedKeys = append(orderedKeys, key)
	}
	sort.Slice(orderedKeys, func(i, j int) bool {
		if orderedKeys[i].actorType == orderedKeys[j].actorType {
			return orderedKeys[i].actorID < orderedKeys[j].actorID
		}
		return orderedKeys[i].actorType < orderedKeys[j].actorType
	})
	if len(factsList) != len(orderedKeys) {
		return nil, ErrReverificationRequired
	}
	hashes := make([]string, 0, len(factsList))
	for index, facts := range factsList {
		facts = facts.normalized()
		key := beneficiaryKey{actorType: facts.ActorType, actorID: facts.ActorID}
		if key != orderedKeys[index] || !facts.validFor(key.actorType, key.actorID) {
			return nil, ErrReverificationRequired
		}
		beneficiarySnapshots := required[key]
		firstSnapshot := beneficiarySnapshots[0]
		var destinationID string
		var destinationVersion int
		if err := source.QueryRowContext(ctx, `SELECT id,version FROM wlt.official_wallet_destinations WHERE actor_type=$1 AND actor_id=$2 AND verification_status='VERIFIED' AND status='ACTIVE_FOR_PAYOUT' FOR UPDATE`, key.actorType, key.actorID).Scan(&destinationID, &destinationVersion); err != nil {
			return nil, ErrReverificationRequired
		}
		if destinationID != firstSnapshot.DestinationID || destinationVersion != firstSnapshot.DestinationVersion {
			return nil, ErrReverificationRequired
		}
		if err := facts.matchesStoredDestination(ctx, source, cipher, destinationID, key.actorType, key.actorID, true); err != nil {
			return nil, err
		}
		destination, err := readOfficialWalletDestination(ctx, source, destinationID)
		if err != nil {
			return nil, err
		}
		for _, snapshot := range beneficiarySnapshots {
			if !snapshot.matchesIdentityFacts(facts) || !snapshot.matchesDestination(destination) {
				return nil, ErrReverificationRequired
			}
		}
		hashes = append(hashes, facts.fingerprint())
	}
	return hashes, nil
}
