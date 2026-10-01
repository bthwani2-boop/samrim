package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

var (
	ErrStoreCommercialTypeAssignmentInvalid  = errors.New("store commercial type assignment is invalid")
	ErrStoreCommercialTypeAssignmentConflict = errors.New("store commercial type assignment conflicts with current state")
	ErrStoreCommercialTypeAssignmentVersion  = errors.New("store version is stale")
)

type StoreCommercialTypeAssignmentResult struct {
	StoreID               string
	CommercialStoreTypeID string
	Version               int
	Replayed              bool
}

func SetStoreCommercialType(ctx context.Context, db *sql.DB, storeID, typeID, actorID, reason, correlationID, idempotencyKey string, expectedVersion int) (StoreCommercialTypeAssignmentResult, error) {
	storeID = strings.TrimSpace(storeID)
	typeID = strings.TrimSpace(typeID)
	actorID = strings.TrimSpace(actorID)
	reason = strings.Join(strings.Fields(strings.TrimSpace(reason)), " ")
	correlationID = strings.TrimSpace(correlationID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if db == nil || storeID == "" || len(storeID) > 128 || typeID == "" || len(typeID) > 128 || actorID == "" || len(actorID) > 128 || len(reason) < 5 || len(reason) > 500 || len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || expectedVersion < 1 {
		return StoreCommercialTypeAssignmentResult{}, ErrStoreCommercialTypeAssignmentInvalid
	}
	requestHash := hashFacts("store-commercial-type-assignment", storeID, typeID, actorID, reason, strconv.Itoa(expectedVersion))
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:store-commercial-type:idempotency:"+idempotencyKey); err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	var storedHash, storedEntity, storedStoreID string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,entity_type,entity_id FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedEntity, &storedStoreID)
	if err == nil {
		if storedHash != requestHash || storedEntity != "store_type_assignment" || storedStoreID != storeID {
			return StoreCommercialTypeAssignmentResult{}, ErrCatalogIdempotencyConflict
		}
		var result StoreCommercialTypeAssignmentResult
		err = tx.QueryRowContext(ctx, `SELECT id,commercial_store_type_id,version FROM dsh.stores WHERE id=$1`, storeID).Scan(&result.StoreID, &result.CommercialStoreTypeID, &result.Version)
		if errors.Is(err, sql.ErrNoRows) {
			return StoreCommercialTypeAssignmentResult{}, ErrStoreCommercialTypeAssignmentConflict
		}
		if err != nil {
			return StoreCommercialTypeAssignmentResult{}, err
		}
		result.Replayed = true
		if err := tx.Commit(); err != nil {
			return StoreCommercialTypeAssignmentResult{}, err
		}
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:store-commercial-type:store:"+storeID); err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	var currentVersion int
	var verticalID string
	var currentType sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT primary_vertical_id,commercial_store_type_id,version FROM dsh.stores WHERE id=$1 FOR UPDATE`, storeID).Scan(&verticalID, &currentType, &currentVersion); errors.Is(err, sql.ErrNoRows) {
		return StoreCommercialTypeAssignmentResult{}, ErrStoreCommercialTypeAssignmentConflict
	} else if err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	if currentVersion != expectedVersion {
		return StoreCommercialTypeAssignmentResult{}, ErrStoreCommercialTypeAssignmentVersion
	}
	if currentType.Valid {
		return StoreCommercialTypeAssignmentResult{}, ErrStoreCommercialTypeAssignmentConflict
	}
	var typeActive, verticalActive bool
	if err := tx.QueryRowContext(ctx, `SELECT type.active,vertical.active FROM dsh.commercial_store_types type JOIN dsh.commerce_verticals vertical ON vertical.id=type.vertical_id WHERE type.id=$1 AND type.vertical_id=$2 FOR SHARE OF type,vertical`, typeID, verticalID).Scan(&typeActive, &verticalActive); errors.Is(err, sql.ErrNoRows) {
		return StoreCommercialTypeAssignmentResult{}, ErrCommercialStoreTypeNotFound
	} else if err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	if !typeActive || !verticalActive {
		return StoreCommercialTypeAssignmentResult{}, ErrStoreCommercialTypeAssignmentConflict
	}
	var result StoreCommercialTypeAssignmentResult
	err = tx.QueryRowContext(ctx, `UPDATE dsh.stores SET commercial_store_type_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 AND commercial_store_type_id IS NULL RETURNING id,commercial_store_type_id,version`, storeID, typeID, expectedVersion).Scan(&result.StoreID, &result.CommercialStoreTypeID, &result.Version)
	if err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'store_type_assignment',$3)`, idempotencyKey, requestHash, storeID); err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	if err := writeCatalogRegistryAudit(ctx, tx, CatalogRegistryAuditInput{EntityType: "store_type_assignment", EntityID: storeID, Action: "UPDATED", ActingActorID: actorID, CorrelationID: correlationID, Reason: reason, ExpectedVersion: expectedVersion, ResultingVersion: result.Version, BeforeState: map[string]any{"storeId": storeID, "verticalId": verticalID, "commercialStoreTypeId": nil}, AfterState: map[string]any{"storeId": storeID, "verticalId": verticalID, "commercialStoreTypeId": typeID}}); err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCommercialTypeAssignmentResult{}, err
	}
	return result, nil
}
