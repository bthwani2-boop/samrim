package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

var ErrCommercialStoreTypeNotFound = errors.New("commercial store type was not found")
var ErrCommercialStoreTypeInvalid = errors.New("commercial store type facts are invalid")

type CommercialStoreTypeRecord struct {
	ID, VerticalID, NameAr, NameEn string
	Active                         bool
	Version                        int
	CreatedAt, UpdatedAt           time.Time
}

type CommercialStoreTypeResult struct {
	StoreType CommercialStoreTypeRecord
	Replayed  bool
}

type UpdateCommercialStoreTypeInput struct {
	NameAr, NameEn  string
	Active          bool
	ExpectedVersion int
}

func HashCommercialStoreTypeCreateRequest(item CommercialStoreTypeRecord, reason string) string {
	return hashFacts("commercial-store-type", strings.TrimSpace(item.ID), strings.TrimSpace(item.VerticalID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active), strings.TrimSpace(reason))
}

func HashCommercialStoreTypeUpdateRequest(id string, input UpdateCommercialStoreTypeInput, reason string) string {
	return hashFacts("commercial-store-type-update", strings.TrimSpace(id), strings.TrimSpace(input.NameAr), strings.TrimSpace(input.NameEn), strconv.FormatBool(input.Active), strconv.Itoa(input.ExpectedVersion), strings.TrimSpace(reason))
}

func ListCommercialStoreTypes(ctx context.Context, db *sql.DB, verticalID string, activeOnly bool) ([]CommercialStoreTypeRecord, error) {
	query := `SELECT type.id,type.vertical_id,type.name_ar,type.name_en,type.active,type.version,type.created_at,type.updated_at
		FROM dsh.commercial_store_types type JOIN dsh.commerce_verticals vertical ON vertical.id=type.vertical_id
		WHERE type.vertical_id=$1 AND ($2=false OR (type.active=true AND vertical.active=true))`
	query += " ORDER BY lower(type.name_en),type.id"
	rows, err := db.QueryContext(ctx, query, strings.TrimSpace(verticalID), activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CommercialStoreTypeRecord, 0)
	for rows.Next() {
		var item CommercialStoreTypeRecord
		if err = rows.Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ReadCommercialStoreType(ctx context.Context, db *sql.DB, id string) (CommercialStoreTypeRecord, error) {
	id = strings.TrimSpace(id)
	if db == nil || id == "" || len(id) > 128 {
		return CommercialStoreTypeRecord{}, ErrCommercialStoreTypeInvalid
	}
	var item CommercialStoreTypeRecord
	err := db.QueryRowContext(ctx, `SELECT type.id,type.vertical_id,type.name_ar,type.name_en,type.active,type.version,type.created_at,type.updated_at FROM dsh.commercial_store_types type WHERE type.id=$1`, strings.TrimSpace(id)).Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeRecord{}, ErrCommercialStoreTypeNotFound
	}
	return item, err
}

func ReadActiveCommercialStoreType(ctx context.Context, db *sql.DB, id string) (CommercialStoreTypeRecord, error) {
	id = strings.TrimSpace(id)
	if db == nil || id == "" || len(id) > 128 {
		return CommercialStoreTypeRecord{}, ErrCommercialStoreTypeInvalid
	}
	var item CommercialStoreTypeRecord
	err := db.QueryRowContext(ctx, `SELECT type.id,type.vertical_id,type.name_ar,type.name_en,type.active,type.version,type.created_at,type.updated_at FROM dsh.commercial_store_types type JOIN dsh.commerce_verticals vertical ON vertical.id=type.vertical_id WHERE type.id=$1 AND type.active=true AND vertical.active=true`, id).Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeRecord{}, ErrCommercialStoreTypeNotFound
	}
	return item, err
}

func CreateCommercialStoreType(ctx context.Context, db *sql.DB, item CommercialStoreTypeRecord, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) (CommercialStoreTypeResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommercialStoreTypeResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	var entityType, entityID, storedHash string
	err = tx.QueryRowContext(ctx, `SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&entityType, &entityID, &storedHash)
	if err == nil {
		if entityType != "commercial_store_type" || storedHash != requestHash {
			return CommercialStoreTypeResult{}, ErrCatalogIdempotencyConflict
		}
		item, err = readCommercialStoreTypeTx(ctx, tx, entityID)
		if err != nil {
			return CommercialStoreTypeResult{}, err
		}
		if err = tx.Commit(); err != nil {
			return CommercialStoreTypeResult{}, err
		}
		return CommercialStoreTypeResult{StoreType: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeResult{}, err
	}
	var active bool
	if err = tx.QueryRowContext(ctx, `SELECT active FROM dsh.commerce_verticals WHERE id=$1 FOR SHARE`, item.VerticalID).Scan(&active); errors.Is(err, sql.ErrNoRows) || (err == nil && !active) {
		return CommercialStoreTypeResult{}, ErrCatalogVerticalNotFound
	}
	if err != nil {
		return CommercialStoreTypeResult{}, err
	}
	if item.ID == "" {
		item.ID, err = newID("store_type")
		if err != nil {
			return CommercialStoreTypeResult{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en,active) VALUES($1,$2,$3,$4,$5)`, item.ID, item.VerticalID, item.NameAr, item.NameEn, item.Active); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'commercial_store_type',$3)`, idempotencyKey, requestHash, item.ID); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	item, err = readCommercialStoreTypeTx(ctx, tx, item.ID)
	if err != nil {
		return CommercialStoreTypeResult{}, err
	}
	audit.EntityType, audit.EntityID, audit.Action = "commercial_store_type", item.ID, "CREATED"
	audit.ExpectedVersion, audit.ResultingVersion, audit.AfterState = 0, item.Version, item
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	return CommercialStoreTypeResult{StoreType: item}, nil
}

func UpdateCommercialStoreType(ctx context.Context, db *sql.DB, id string, input UpdateCommercialStoreTypeInput, idempotencyKey, requestHash string, audit CatalogRegistryAuditInput) (CommercialStoreTypeResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommercialStoreTypeResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	var entityType, entityID, storedHash string
	err = tx.QueryRowContext(ctx, `SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&entityType, &entityID, &storedHash)
	if err == nil {
		if entityType != "commercial_store_type" || entityID != id || storedHash != requestHash {
			return CommercialStoreTypeResult{}, ErrCatalogIdempotencyConflict
		}
		item, err := readCommercialStoreTypeTx(ctx, tx, id)
		if err != nil {
			return CommercialStoreTypeResult{}, err
		}
		if err = tx.Commit(); err != nil {
			return CommercialStoreTypeResult{}, err
		}
		return CommercialStoreTypeResult{StoreType: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeResult{}, err
	}
	before, err := readCommercialStoreTypeForUpdateTx(ctx, tx, id)
	if err != nil {
		return CommercialStoreTypeResult{}, err
	}
	if before.Version != input.ExpectedVersion {
		return CommercialStoreTypeResult{}, ErrCatalogVersionConflict
	}
	if _, err = tx.ExecContext(ctx, `UPDATE dsh.commercial_store_types SET name_ar=$2,name_en=$3,active=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$5`, id, input.NameAr, input.NameEn, input.Active, input.ExpectedVersion); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'commercial_store_type',$3)`, idempotencyKey, requestHash, id); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	after, err := readCommercialStoreTypeTx(ctx, tx, id)
	if err != nil {
		return CommercialStoreTypeResult{}, err
	}
	audit.EntityType, audit.EntityID, audit.Action = "commercial_store_type", id, "UPDATED"
	audit.ExpectedVersion, audit.ResultingVersion, audit.BeforeState, audit.AfterState = before.Version, after.Version, before, after
	if err = writeCatalogRegistryAudit(ctx, tx, audit); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommercialStoreTypeResult{}, err
	}
	return CommercialStoreTypeResult{StoreType: after}, nil
}

func readCommercialStoreTypeTx(ctx context.Context, tx *sql.Tx, id string) (CommercialStoreTypeRecord, error) {
	var item CommercialStoreTypeRecord
	err := tx.QueryRowContext(ctx, `SELECT id,vertical_id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.commercial_store_types WHERE id=$1`, id).Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeRecord{}, ErrCommercialStoreTypeNotFound
	}
	return item, err
}

func readCommercialStoreTypeForUpdateTx(ctx context.Context, tx *sql.Tx, id string) (CommercialStoreTypeRecord, error) {
	var item CommercialStoreTypeRecord
	err := tx.QueryRowContext(ctx, `SELECT id,vertical_id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.commercial_store_types WHERE id=$1 FOR UPDATE`, id).Scan(&item.ID, &item.VerticalID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommercialStoreTypeRecord{}, ErrCommercialStoreTypeNotFound
	}
	return item, err
}
