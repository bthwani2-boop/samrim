package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrCatalogItemNotFound  = errors.New("catalog item was not found")
	ErrCatalogIdempotency   = errors.New("catalog item idempotency key was already used with different facts")
	ErrCatalogVersion       = errors.New("catalog item version is stale")
	ErrCatalogStoreNotFound = errors.New("catalog store was not found")
	ErrCatalogInvalidState  = errors.New("catalog publication state is invalid")
)

type CatalogItemRecord struct {
	ID               string
	StoreID          string
	Name             string
	PublicationState string
	Availability     bool
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type CatalogItemResult struct {
	Item     CatalogItemRecord
	Replayed bool
}

func HashCatalogCreateRequest(storeID, name string) string {
	return hashFacts(storeID, name)
}

func HashCatalogUpdateRequest(storeID, itemID, name, state string, availability bool, expectedVersion int) string {
	return hashFacts(storeID, itemID, name, state, strconv.FormatBool(availability), strconv.Itoa(expectedVersion))
}

func ListCatalogItems(ctx context.Context, db *sql.DB, storeID string, publicOnly bool) ([]CatalogItemRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	query := `SELECT id,store_id,name,publication_state,availability,version,created_at,updated_at FROM dsh.catalog_items WHERE store_id=$1`
	if publicOnly {
		query += " AND publication_state='published' AND availability=true"
	}
	query += " ORDER BY created_at ASC,id ASC"
	rows, err := db.QueryContext(ctx, query, strings.TrimSpace(storeID))
	if err != nil {
		return nil, fmt.Errorf("list catalog items: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]CatalogItemRecord, 0)
	for rows.Next() {
		item, err := scanCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listCatalogItemsForStores(ctx context.Context, db *sql.DB, storeIDs []string, publicOnly bool) (map[string][]CatalogItemRecord, error) {
	itemsByStore := make(map[string][]CatalogItemRecord, len(storeIDs))
	if len(storeIDs) == 0 {
		return itemsByStore, nil
	}
	query := `SELECT id,store_id,name,publication_state,availability,version,created_at,updated_at FROM dsh.catalog_items WHERE store_id = ANY($1::text[])`
	if publicOnly {
		query += " AND publication_state='published' AND availability=true"
	}
	query += " ORDER BY store_id ASC, created_at ASC, id ASC"
	rows, err := db.QueryContext(ctx, query, pq.Array(storeIDs))
	if err != nil {
		return nil, fmt.Errorf("list catalog items for stores: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		item, err := scanCatalogItem(rows)
		if err != nil {
			return nil, err
		}
		itemsByStore[item.StoreID] = append(itemsByStore[item.StoreID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read catalog items for stores: %w", err)
	}
	return itemsByStore, nil
}

func ReadCatalogItem(ctx context.Context, db *sql.DB, storeID, itemID string) (CatalogItemRecord, error) {
	item, err := scanCatalogItem(db.QueryRowContext(ctx, `SELECT id,store_id,name,publication_state,availability,version,created_at,updated_at FROM dsh.catalog_items WHERE store_id=$1 AND id=$2`, strings.TrimSpace(storeID), strings.TrimSpace(itemID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogItemRecord{}, ErrCatalogItemNotFound
	}
	if err != nil {
		return CatalogItemRecord{}, err
	}
	return item, nil
}

func CreateCatalogItem(ctx context.Context, db *sql.DB, storeID, name, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogItemResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogItemResult{}, fmt.Errorf("begin catalog item creation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCatalogKey(ctx, tx, idempotencyKey); err != nil {
		return CatalogItemResult{}, err
	}
	var storedHash, storedStoreID, storedItemID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,store_id,item_id,operation FROM dsh.catalog_item_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedStoreID, &storedItemID, &operation)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || operation != "create" {
			return CatalogItemResult{}, ErrCatalogIdempotency
		}
		item, readErr := readCatalogItemTx(ctx, tx, storeID, storedItemID)
		if readErr != nil {
			return CatalogItemResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogItemResult{}, err
		}
		return CatalogItemResult{Item: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogItemResult{}, err
	}
	if err := ensureCatalogStoreTx(ctx, tx, storeID); err != nil {
		return CatalogItemResult{}, err
	}
	itemID, err := newID("item")
	if err != nil {
		return CatalogItemResult{}, err
	}
	item, err := scanCatalogItem(tx.QueryRowContext(ctx, `INSERT INTO dsh.catalog_items(id,store_id,name) VALUES($1,$2,$3) RETURNING id,store_id,name,publication_state,availability,version,created_at,updated_at`, itemID, storeID, name))
	if err != nil {
		return CatalogItemResult{}, fmt.Errorf("create catalog item: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_item_mutation_idempotency(idempotency_key,request_hash,store_id,item_id,operation,result_name,result_state,result_availability,result_version) VALUES($1,$2,$3,$4,'create',$5,$6,$7,$8)`, idempotencyKey, requestHash, storeID, item.ID, item.Name, item.PublicationState, item.Availability, item.Version); err != nil {
		return CatalogItemResult{}, err
	}
	if err := auditCatalogItemTx(ctx, tx, "catalog_item_created", idempotencyKey, correlationID, actingActorID, storeID, item.ID, "", item.PublicationState, 0, item.Version, requestHash, item.Availability); err != nil {
		return CatalogItemResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogItemResult{}, err
	}
	return CatalogItemResult{Item: item}, nil
}

func UpdateCatalogItem(ctx context.Context, db *sql.DB, storeID, itemID, name, state string, availability bool, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogItemResult, error) {
	if state != "draft" && state != "published" && state != "hidden" {
		return CatalogItemResult{}, ErrCatalogInvalidState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogItemResult{}, fmt.Errorf("begin catalog item update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCatalogKey(ctx, tx, idempotencyKey); err != nil {
		return CatalogItemResult{}, err
	}
	var storedHash, storedStoreID, storedItemID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,store_id,item_id,operation FROM dsh.catalog_item_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedStoreID, &storedItemID, &operation)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedItemID != itemID || operation != "update" {
			return CatalogItemResult{}, ErrCatalogIdempotency
		}
		item, readErr := readCatalogItemTx(ctx, tx, storeID, itemID)
		if readErr != nil {
			return CatalogItemResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogItemResult{}, err
		}
		return CatalogItemResult{Item: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogItemResult{}, err
	}
	current, err := readCatalogItemTxForUpdate(ctx, tx, storeID, itemID)
	if errors.Is(err, ErrCatalogItemNotFound) {
		return CatalogItemResult{}, err
	}
	if err != nil {
		return CatalogItemResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogItemResult{}, ErrCatalogVersion
	}
	updated, err := scanCatalogItem(tx.QueryRowContext(ctx, `UPDATE dsh.catalog_items SET name=$3,publication_state=$4,availability=$5,version=version+1,updated_at=clock_timestamp() WHERE store_id=$1 AND id=$2 AND version=$6 RETURNING id,store_id,name,publication_state,availability,version,created_at,updated_at`, storeID, itemID, name, state, availability, expectedVersion))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CatalogItemResult{}, ErrCatalogVersion
		}
		return CatalogItemResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_item_mutation_idempotency(idempotency_key,request_hash,store_id,item_id,operation,result_name,result_state,result_availability,result_version) VALUES($1,$2,$3,$4,'update',$5,$6,$7,$8)`, idempotencyKey, requestHash, storeID, itemID, updated.Name, updated.PublicationState, updated.Availability, updated.Version); err != nil {
		return CatalogItemResult{}, err
	}
	if err := auditCatalogItemTx(ctx, tx, "catalog_item_updated", idempotencyKey, correlationID, actingActorID, storeID, itemID, current.PublicationState, updated.PublicationState, expectedVersion, updated.Version, requestHash, updated.Availability); err != nil {
		return CatalogItemResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogItemResult{}, err
	}
	return CatalogItemResult{Item: updated}, nil
}

func ensureCatalogStoreTx(ctx context.Context, tx *sql.Tx, storeID string) error {
	var found string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE id=$1 FOR SHARE", storeID).Scan(&found); errors.Is(err, sql.ErrNoRows) {
		return ErrCatalogStoreNotFound
	} else {
		return err
	}
}

func readCatalogItemTx(ctx context.Context, tx *sql.Tx, storeID, itemID string) (CatalogItemRecord, error) {
	return readCatalogItemTxWithQuery(ctx, tx.QueryRowContext(ctx, `SELECT id,store_id,name,publication_state,availability,version,created_at,updated_at FROM dsh.catalog_items WHERE store_id=$1 AND id=$2`, storeID, itemID))
}

func readCatalogItemTxForUpdate(ctx context.Context, tx *sql.Tx, storeID, itemID string) (CatalogItemRecord, error) {
	return readCatalogItemTxWithQuery(ctx, tx.QueryRowContext(ctx, `SELECT id,store_id,name,publication_state,availability,version,created_at,updated_at FROM dsh.catalog_items WHERE store_id=$1 AND id=$2 FOR UPDATE`, storeID, itemID))
}

func readCatalogItemTxWithQuery(ctx context.Context, row rowScanner) (CatalogItemRecord, error) {
	item, err := scanCatalogItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogItemRecord{}, ErrCatalogItemNotFound
	}
	return item, err
}

func scanCatalogItem(row rowScanner) (CatalogItemRecord, error) {
	var item CatalogItemRecord
	if err := row.Scan(&item.ID, &item.StoreID, &item.Name, &item.PublicationState, &item.Availability, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return CatalogItemRecord{}, err
	}
	return item, nil
}

func lockCatalogKey(ctx context.Context, tx *sql.Tx, key string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("catalog idempotency key is invalid")
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog:idempotency:"+key)
	return err
}

func auditCatalogItemTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, correlationID, actingActorID, storeID, itemID, fromState, toState string, expectedVersion, resultVersion int, requestHash string, availability bool) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_item_audit(event_type,idempotency_key,correlation_id,acting_actor_id,store_id,item_id,from_state,to_state,expected_version,result_version,request_hash,availability) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,NULLIF($9,0),$10,$11,$12)`, eventType, idempotencyKey, correlationID, actingActorID, storeID, itemID, fromState, toState, expectedVersion, resultVersion, requestHash, availability)
	return err
}
