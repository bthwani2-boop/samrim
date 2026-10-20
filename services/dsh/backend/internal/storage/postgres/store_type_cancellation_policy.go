package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

var ErrCancellationPolicyConflict = errors.New("cancellation policy changed or replay conflicts")

func ValidCancellationMode(mode string) bool {
	return mode == "OPERATIONS_ONLY" || mode == "CLIENT_BEFORE_ACCEPTANCE"
}

// UpdateStoreTypeCancellationMode writes the canonical Store-Type policy and
// an immutable audit row atomically. Existing Orders keep their own snapshot.
func UpdateStoreTypeCancellationMode(ctx context.Context, db *sql.DB, storeTypeID, mode, reason, actor, idem, correlation string, expected int) (CommercialStoreTypeRecord, bool, error) {
	storeTypeID, mode, reason = strings.TrimSpace(storeTypeID), strings.TrimSpace(mode), strings.TrimSpace(reason)
	if db == nil || storeTypeID == "" || !ValidCancellationMode(mode) || expected < 1 ||
		len([]rune(reason)) < 5 || len([]rune(reason)) > 500 ||
		strings.TrimSpace(actor) == "" || len(idem) < 8 || len(correlation) < 8 {
		return CommercialStoreTypeRecord{}, false, ErrCommercialStoreTypeInvalid
	}
	hash := hashFacts("store-type-cancellation-mode-v1", storeTypeID, mode, strconv.Itoa(expected), reason, strings.TrimSpace(actor))
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-type-cancellation:"+idem); err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	var oldHash, storedID, resultingMode string
	var resultingVersion int
	err = tx.QueryRowContext(ctx, "SELECT store_type_id,request_hash,resulting_mode,resulting_version FROM dsh.store_type_cancellation_policy_audit WHERE idempotency_key=$1", idem).Scan(&storedID, &oldHash, &resultingMode, &resultingVersion)
	if err == nil {
		if oldHash != hash || storedID != storeTypeID {
			return CommercialStoreTypeRecord{}, false, ErrCancellationPolicyConflict
		}
		current, readErr := readCommercialStoreTypeTx(ctx, tx, storeTypeID)
		if readErr != nil {
			return CommercialStoreTypeRecord{}, false, readErr
		}
		if current.Version != resultingVersion || current.CancellationMode != resultingMode {
			return CommercialStoreTypeRecord{}, false, ErrCancellationPolicyConflict
		}
		if err := tx.Commit(); err != nil {
			return CommercialStoreTypeRecord{}, false, err
		}
		return current, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeRecord{}, false, err
	}
	current, err := readCommercialStoreTypeForUpdateTx(ctx, tx, storeTypeID)
	if err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	if current.Version != expected || current.CancellationMode == mode {
		return CommercialStoreTypeRecord{}, false, ErrCancellationPolicyConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.commercial_store_types SET cancellation_mode=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3", storeTypeID, mode, expected); err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_type_cancellation_policy_audit
		(store_type_id,previous_mode,resulting_mode,expected_version,resulting_version,acting_actor_id,reason,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, storeTypeID, current.CancellationMode, mode, expected, expected+1, actor, reason, idem, hash, correlation); err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	updated, err := readCommercialStoreTypeTx(ctx, tx, storeTypeID)
	if err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CommercialStoreTypeRecord{}, false, err
	}
	return updated, false, nil
}
