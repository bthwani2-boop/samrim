package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

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

func PreparePayout(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input PreparePayoutInput) (PayoutRequestRecord, error) {
	input.PayoutID, input.ActorID = strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.Reason, input.Evidence = strings.TrimSpace(input.Reason), strings.TrimSpace(input.Evidence)
	input.IdentityFacts = input.IdentityFacts.normalized()
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.Reason, 1, 512) == "" || boundedText(input.Evidence, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	if !input.IdentityFacts.validFor(input.IdentityFacts.ActorType, input.IdentityFacts.ActorID) {
		return PayoutRequestRecord{}, ErrReverificationRequired
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hash := hashFacts("payout-prepare-v2", input.PayoutID, input.ActorID, input.Reason, input.Evidence, input.IdentityFacts.fingerprint())
	payout, err := readPayoutForUpdate(ctx, tx, input.PayoutID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if !input.IdentityFacts.validFor(payout.ActorType, payout.BeneficiaryActorID) {
		return PayoutRequestRecord{}, ErrReverificationRequired
	}
	var currentDestinationID string
	var currentDestinationVersion int
	if err := tx.QueryRowContext(ctx, "SELECT id,version FROM wlt.official_wallet_destinations WHERE actor_type=$1 AND actor_id=$2 AND verification_status='VERIFIED' AND status='ACTIVE_FOR_PAYOUT' FOR UPDATE", payout.ActorType, payout.BeneficiaryActorID).Scan(&currentDestinationID, &currentDestinationVersion); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PayoutRequestRecord{}, ErrReverificationRequired
		}
		return PayoutRequestRecord{}, err
	}
	if currentDestinationID != payout.DestinationID || currentDestinationVersion != payout.DestinationVersion {
		return PayoutRequestRecord{}, ErrReverificationRequired
	}
	if err := input.IdentityFacts.matchesStoredDestination(ctx, tx, cipher, currentDestinationID, payout.ActorType, payout.BeneficiaryActorID, true); err != nil {
		return PayoutRequestRecord{}, commitIdentityStaleness(tx, err)
	}
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
	if payout.Status != "HELD" {
		return PayoutRequestRecord{}, ErrPayoutState
	}
	destination, err := readOfficialWalletDestination(ctx, tx, payout.DestinationID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if destination.BeneficiaryIdentityVersion < 1 {
		return PayoutRequestRecord{}, ErrReverificationRequired
	}
	snapshotHash := hashFacts("approved-payout-snapshot-v2", input.PayoutID, payout.ActorType, payout.BeneficiaryActorID, destination.BeneficiaryName, formatInt(destination.BeneficiaryIdentityVersion), destination.ProviderKey, destination.WalletIdentifierMasked, destination.ID, formatInt(payout.DestinationVersion), input.IdentityFacts.fingerprint(), payout.Status)
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.approved_payout_snapshots(payout_id,actor_type,actor_id,beneficiary_name,beneficiary_identity_version,provider_key,masked_destination,destination_id,destination_version,amount_mode,resolved_amount_minor,currency,policy_version,snapshot_hash,prepared_by,identity_actor_version_snapshot,identity_role_version_snapshot,role_enabled_snapshot,security_enabled_snapshot,official_name_status_snapshot) SELECT id,actor_type,$13,$2,$3,$4,$5,destination_id,destination_version,amount_mode,resolved_amount_minor,currency,policy_version,$6,$7,$8,$9,$10,$11,$12 FROM wlt.payout_requests WHERE id=$1`, input.PayoutID, destination.BeneficiaryName, destination.BeneficiaryIdentityVersion, destination.ProviderKey, destination.WalletIdentifierMasked, snapshotHash, input.ActorID, input.IdentityFacts.ActorVersion, input.IdentityFacts.RoleVersion, input.IdentityFacts.RoleEnabled, input.IdentityFacts.SecurityEnabled, input.IdentityFacts.OfficialNameStatus, payout.BeneficiaryActorID); err != nil {
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

func ApprovePayout(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input ApprovePayoutInput) (PayoutRequestRecord, error) {
	input.PayoutID, input.ActorID = strings.TrimSpace(input.PayoutID), strings.TrimSpace(input.ActorID)
	input.Reason, input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.Reason), strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	input.IdentityFacts = input.IdentityFacts.normalized()
	if db == nil || cipher == nil || boundedText(input.PayoutID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.Reason, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	return transitionPayout(ctx, db, cipher, "PAYOUT_APPROVED", input.PayoutID, input.ActorID, input.Reason, "", &input.IdentityFacts, input.IdempotencyKey, input.CorrelationID, func(tx *sql.Tx, payout PayoutRequestRecord) error {
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
	return transitionPayout(ctx, db, nil, "PAYOUT_CANCELLED", input.PayoutID, input.ActorID, input.Reason, "", nil, input.IdempotencyKey, input.CorrelationID, func(tx *sql.Tx, payout PayoutRequestRecord) error {
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

func transitionPayout(ctx context.Context, db *sql.DB, cipher *DestinationCipher, eventType, payoutID, actorID, reason, evidence string, facts *IdentityFacts, idempotencyKey, correlationID string, apply func(*sql.Tx, PayoutRequestRecord) error) (PayoutRequestRecord, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	hashParts := []string{strings.ToLower(eventType), payoutID, actorID, reason, evidence}
	if facts != nil {
		*facts = facts.normalized()
		hashParts = append(hashParts, facts.fingerprint())
	}
	hash := hashFacts(hashParts...)
	actorType, payoutActorID, err := payoutActor(ctx, tx, payoutID)
	if errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, ErrPayoutNotFound
	}
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if actorType == "captain" {
		if err := lockCaptainWalletBalance(ctx, tx, payoutActorID); err != nil {
			return PayoutRequestRecord{}, err
		}
	}
	payout, err := readPayoutForUpdate(ctx, tx, payoutID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if payout.ActorType != actorType || payout.ActorID != payoutActorID {
		return PayoutRequestRecord{}, ErrPayoutState
	}
	if facts != nil {
		if cipher == nil || !facts.validFor(payout.ActorType, payout.BeneficiaryActorID) {
			return PayoutRequestRecord{}, ErrReverificationRequired
		}
		var currentDestinationID string
		var currentDestinationVersion int
		if err := tx.QueryRowContext(ctx, "SELECT id,version FROM wlt.official_wallet_destinations WHERE actor_type=$1 AND actor_id=$2 AND verification_status='VERIFIED' AND status='ACTIVE_FOR_PAYOUT' FOR UPDATE", payout.ActorType, payout.BeneficiaryActorID).Scan(&currentDestinationID, &currentDestinationVersion); err != nil {
			return PayoutRequestRecord{}, ErrReverificationRequired
		}
		if currentDestinationID != payout.DestinationID || currentDestinationVersion != payout.DestinationVersion {
			return PayoutRequestRecord{}, ErrReverificationRequired
		}
		if err := facts.matchesStoredDestination(ctx, tx, cipher, currentDestinationID, payout.ActorType, payout.BeneficiaryActorID, true); err != nil {
			return PayoutRequestRecord{}, commitIdentityStaleness(tx, err)
		}
		var snapshot PayoutSnapshotRecord
		if err := scanPayoutSnapshot(ctx, tx, payoutID, &snapshot); err != nil {
			return PayoutRequestRecord{}, err
		}
		destination, err := readOfficialWalletDestination(ctx, tx, currentDestinationID)
		if err != nil {
			return PayoutRequestRecord{}, err
		}
		if !snapshot.matchesIdentityFacts(*facts) || !snapshot.matchesDestination(destination) {
			return PayoutRequestRecord{}, ErrReverificationRequired
		}
	}
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
