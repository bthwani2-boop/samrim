package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

type StoreFulfillmentModesResult struct {
	StoreID          string
	Version          int
	FulfillmentModes []string
	Replayed         bool
}

var (
	ErrStoreFulfillmentModesNotFound    = errors.New("owned Store was not found")
	ErrStoreFulfillmentModesIdempotency = errors.New("Store fulfillment modes idempotency key was already used with different facts")
	ErrStoreFulfillmentModesVersion     = errors.New("Store version is stale")
)

func HashStoreFulfillmentModesRequest(storeID, partnerActorID string, modes []string, expectedVersion int) string {
	if len(modes) == 0 {
		return ""
	}
	normalized, err := NormalizeStoreFulfillmentModes(modes)
	if err != nil {
		return ""
	}
	return hashLocationFacts("store-fulfillment-modes", strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID), strings.Join(normalized, ","), strconv.Itoa(expectedVersion))
}

func SetStoreFulfillmentModes(ctx context.Context, db *sql.DB, storeID, partnerActorID string, modes []string, expectedVersion int, idempotencyKey, correlationID string) (StoreFulfillmentModesResult, error) {
	storeID = strings.TrimSpace(storeID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || partnerActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return StoreFulfillmentModesResult{}, ErrFulfillmentModesInvalid
	}
	if len(modes) == 0 {
		return StoreFulfillmentModesResult{}, ErrFulfillmentModesInvalid
	}
	normalizedModes, err := NormalizeStoreFulfillmentModes(modes)
	if err != nil {
		return StoreFulfillmentModesResult{}, err
	}
	requestHash := HashStoreFulfillmentModesRequest(storeID, partnerActorID, normalizedModes, expectedVersion)
	if requestHash == "" {
		return StoreFulfillmentModesResult{}, ErrFulfillmentModesInvalid
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("begin Store fulfillment modes update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-fulfillment-modes:idempotency:"+idempotencyKey); err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("lock Store fulfillment modes idempotency: %w", err)
	}

	var storedHash, storedStoreID, storedPartner string
	var storedExpected, storedVersion int
	var storedModes pq.StringArray
	err = tx.QueryRowContext(ctx, `SELECT request_hash, store_id, partner_actor_id, expected_version, result_version, result_fulfillment_modes
		FROM dsh.store_fulfillment_modes_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(
		&storedHash, &storedStoreID, &storedPartner, &storedExpected, &storedVersion, &storedModes)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedPartner != partnerActorID || storedExpected != expectedVersion {
			return StoreFulfillmentModesResult{}, ErrStoreFulfillmentModesIdempotency
		}
		var owned bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2)", storeID, partnerActorID).Scan(&owned); err != nil {
			return StoreFulfillmentModesResult{}, fmt.Errorf("verify Store ownership for fulfillment modes replay: %w", err)
		}
		if !owned {
			return StoreFulfillmentModesResult{}, ErrStoreFulfillmentModesNotFound
		}
		if err := tx.Commit(); err != nil {
			return StoreFulfillmentModesResult{}, fmt.Errorf("commit Store fulfillment modes replay: %w", err)
		}
		return StoreFulfillmentModesResult{StoreID: storeID, Version: storedVersion, FulfillmentModes: append([]string(nil), storedModes...), Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreFulfillmentModesResult{}, fmt.Errorf("read Store fulfillment modes idempotency: %w", err)
	}

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-fulfillment-modes:store:"+storeID); err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("lock Store fulfillment modes Store: %w", err)
	}
	var currentVersion int
	var currentModes pq.StringArray
	err = tx.QueryRowContext(ctx, `SELECT version, fulfillment_modes FROM dsh.stores
		WHERE id=$1 AND partner_actor_id=$2 FOR UPDATE`, storeID, partnerActorID).Scan(&currentVersion, &currentModes)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreFulfillmentModesResult{}, ErrStoreFulfillmentModesNotFound
	}
	if err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("read owned Store fulfillment modes: %w", err)
	}
	if currentVersion != expectedVersion {
		return StoreFulfillmentModesResult{}, ErrStoreFulfillmentModesVersion
	}
	canonicalCurrentModes, err := NormalizeStoreFulfillmentModes(currentModes)
	if err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("canonical Store fulfillment modes are invalid: %w", err)
	}

	resultVersion := currentVersion
	resultModes := canonicalCurrentModes
	changed := !equalFulfillmentModes(canonicalCurrentModes, normalizedModes)
	if changed {
		var updatedModes pq.StringArray
		err = tx.QueryRowContext(ctx, `UPDATE dsh.stores
			SET fulfillment_modes=$3, version=version+1, updated_at=clock_timestamp()
			WHERE id=$1 AND partner_actor_id=$2 AND version=$4
			RETURNING version, fulfillment_modes`, storeID, partnerActorID, pq.Array(normalizedModes), expectedVersion).Scan(&resultVersion, &updatedModes)
		if err != nil {
			return StoreFulfillmentModesResult{}, fmt.Errorf("update canonical Store fulfillment modes: %w", err)
		}
		resultModes = append([]string(nil), updatedModes...)
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_fulfillment_modes_idempotency
		(idempotency_key, request_hash, store_id, partner_actor_id, expected_version, result_version, result_fulfillment_modes)
		VALUES($1,$2,$3,$4,$5,$6,$7)`, idempotencyKey, requestHash, storeID, partnerActorID, expectedVersion, resultVersion, pq.Array(resultModes)); err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("record Store fulfillment modes idempotency: %w", err)
	}
	if changed {
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_fulfillment_modes_audit
			(event_type, idempotency_key, correlation_id, acting_actor_id, partner_actor_id, store_id, from_modes, to_modes, expected_version, result_version, request_hash)
			VALUES('store_fulfillment_modes_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			idempotencyKey, correlationID, partnerActorID, partnerActorID, storeID, pq.Array(canonicalCurrentModes), pq.Array(resultModes), expectedVersion, resultVersion, requestHash); err != nil {
			return StoreFulfillmentModesResult{}, fmt.Errorf("record Store fulfillment modes audit: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return StoreFulfillmentModesResult{}, fmt.Errorf("commit Store fulfillment modes update: %w", err)
	}
	return StoreFulfillmentModesResult{StoreID: storeID, Version: resultVersion, FulfillmentModes: resultModes}, nil
}

func equalFulfillmentModes(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
