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
	ErrStoreAssortmentNotFound        = errors.New("Store Assortment was not found")
	ErrStoreAssortmentIdempotency     = errors.New("Store Assortment idempotency key was already used with different facts")
	ErrStoreAssortmentVersion         = errors.New("Store Assortment version is stale")
	ErrStoreAssortmentStoreNotFound   = errors.New("catalog store was not found")
	ErrStoreAssortmentProductNotFound = errors.New("central Product was not found")
	ErrStoreAssortmentProductDisabled = errors.New("disabled central Product cannot be published")
	ErrStoreAssortmentAlreadyExists   = errors.New("Store Assortment already exists")
	ErrStoreAssortmentInvalidState    = errors.New("Store Assortment publication state is invalid")
)

type StoreAssortmentRecord struct {
	StoreID          string
	ProductID        string
	Product          CentralProductRecord
	PriceMinor       int64
	Currency         string
	Availability     bool
	PublicationState string
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type StoreAssortmentResult struct {
	Assortment StoreAssortmentRecord
	Replayed   bool
}

func HashStoreAssortmentCreateRequest(storeID, productID string, priceMinor int64) string {
	return hashFacts(strings.TrimSpace(storeID), strings.TrimSpace(productID), strconv.FormatInt(priceMinor, 10))
}

func HashStoreAssortmentUpdateRequest(storeID, productID string, priceMinor int64, availability bool, publicationState string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(storeID), strings.TrimSpace(productID), strconv.FormatInt(priceMinor, 10), strconv.FormatBool(availability), strings.TrimSpace(publicationState), strconv.Itoa(expectedVersion))
}

func ListStoreAssortments(ctx context.Context, db *sql.DB, storeID string, publicOnly bool) ([]StoreAssortmentRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	where := []string{"a.store_id=$1"}
	args := []any{strings.TrimSpace(storeID)}
	if publicOnly {
		where = append(where, "a.publication_state='published'", "a.availability=true", "a.price_minor>0", "p.active=true")
	}
	rows, err := db.QueryContext(ctx, storeAssortmentSelect+" WHERE "+strings.Join(where, " AND ")+" ORDER BY a.created_at ASC,a.product_id ASC", args...)
	if err != nil {
		return nil, fmt.Errorf("list Store Assortments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	assortments := make([]StoreAssortmentRecord, 0)
	for rows.Next() {
		assortment, scanErr := scanStoreAssortment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		assortments = append(assortments, assortment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read Store Assortments: %w", err)
	}
	return assortments, nil
}

func ListStoreAssortmentsForStores(ctx context.Context, db *sql.DB, storeIDs []string, publicOnly bool) (map[string][]StoreAssortmentRecord, error) {
	assortmentsByStore := make(map[string][]StoreAssortmentRecord, len(storeIDs))
	if len(storeIDs) == 0 {
		return assortmentsByStore, nil
	}
	where := []string{"a.store_id=ANY($1::text[])"}
	if publicOnly {
		where = append(where, "a.publication_state='published'", "a.availability=true", "a.price_minor>0", "p.active=true")
	}
	rows, err := db.QueryContext(ctx, storeAssortmentSelect+" WHERE "+strings.Join(where, " AND ")+" ORDER BY a.store_id ASC,a.created_at ASC,a.product_id ASC", pq.Array(storeIDs))
	if err != nil {
		return nil, fmt.Errorf("list Store Assortments for Stores: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		assortment, scanErr := scanStoreAssortment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		assortmentsByStore[assortment.StoreID] = append(assortmentsByStore[assortment.StoreID], assortment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read Store Assortments for Stores: %w", err)
	}
	return assortmentsByStore, nil
}

func ReadStoreAssortment(ctx context.Context, db *sql.DB, storeID, productID string) (StoreAssortmentRecord, error) {
	if db == nil {
		return StoreAssortmentRecord{}, errors.New("DSH database is nil")
	}
	assortment, err := scanStoreAssortment(db.QueryRowContext(ctx, storeAssortmentSelect+" WHERE a.store_id=$1 AND a.product_id=$2", strings.TrimSpace(storeID), strings.TrimSpace(productID)))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreAssortmentRecord{}, ErrStoreAssortmentNotFound
	}
	if err != nil {
		return StoreAssortmentRecord{}, fmt.Errorf("read Store Assortment: %w", err)
	}
	return assortment, nil
}

func CreateStoreAssortment(ctx context.Context, db *sql.DB, storeID, productID string, priceMinor int64, idempotencyKey, requestHash, actingActorID, correlationID string) (StoreAssortmentResult, error) {
	if db == nil {
		return StoreAssortmentResult{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreAssortmentResult{}, fmt.Errorf("begin Store Assortment creation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockStoreAssortmentKey(ctx, tx, idempotencyKey); err != nil {
		return StoreAssortmentResult{}, err
	}
	var storedHash, storedStoreID, storedProductID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,store_id,product_id,operation FROM dsh.store_assortment_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedStoreID, &storedProductID, &operation)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedProductID != productID || operation != "create" {
			return StoreAssortmentResult{}, ErrStoreAssortmentIdempotency
		}
		assortment, readErr := readStoreAssortmentTx(ctx, tx, storeID, productID)
		if readErr != nil {
			return StoreAssortmentResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return StoreAssortmentResult{}, err
		}
		return StoreAssortmentResult{Assortment: assortment, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreAssortmentResult{}, fmt.Errorf("read Store Assortment idempotency: %w", err)
	}
	if priceMinor <= 0 {
		return StoreAssortmentResult{}, errors.New("Store Assortment price is invalid")
	}
	if err := ensureStoreForAssortmentTx(ctx, tx, storeID); err != nil {
		return StoreAssortmentResult{}, err
	}
	if err := ensureActiveProductForAssortmentTx(ctx, tx, productID); err != nil {
		return StoreAssortmentResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_assortments(store_id,product_id,price_minor) VALUES($1,$2,$3)`, storeID, productID, priceMinor); err != nil {
		if isUniqueViolation(err) {
			return StoreAssortmentResult{}, ErrStoreAssortmentAlreadyExists
		}
		return StoreAssortmentResult{}, fmt.Errorf("create Store Assortment: %w", err)
	}
	assortment, err := readStoreAssortmentTx(ctx, tx, storeID, productID)
	if err != nil {
		return StoreAssortmentResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_assortment_mutation_idempotency(idempotency_key,request_hash,store_id,product_id,operation,result_version) VALUES($1,$2,$3,$4,'create',$5)`, idempotencyKey, requestHash, storeID, productID, assortment.Version); err != nil {
		return StoreAssortmentResult{}, err
	}
	if err := auditStoreAssortmentTx(ctx, tx, "store_assortment_created", idempotencyKey, correlationID, actingActorID, assortment, "", 0, requestHash); err != nil {
		return StoreAssortmentResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAssortmentResult{}, err
	}
	return StoreAssortmentResult{Assortment: assortment}, nil
}

func UpdateStoreAssortment(ctx context.Context, db *sql.DB, storeID, productID string, priceMinor int64, availability bool, publicationState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (StoreAssortmentResult, error) {
	if db == nil {
		return StoreAssortmentResult{}, errors.New("DSH database is nil")
	}
	if publicationState != "draft" && publicationState != "published" && publicationState != "hidden" {
		return StoreAssortmentResult{}, ErrStoreAssortmentInvalidState
	}
	if priceMinor <= 0 || expectedVersion < 1 {
		return StoreAssortmentResult{}, errors.New("Store Assortment facts are invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreAssortmentResult{}, fmt.Errorf("begin Store Assortment update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockStoreAssortmentKey(ctx, tx, idempotencyKey); err != nil {
		return StoreAssortmentResult{}, err
	}
	var storedHash, storedStoreID, storedProductID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,store_id,product_id,operation FROM dsh.store_assortment_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedStoreID, &storedProductID, &operation)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedProductID != productID || operation != "update" {
			return StoreAssortmentResult{}, ErrStoreAssortmentIdempotency
		}
		assortment, readErr := readStoreAssortmentTx(ctx, tx, storeID, productID)
		if readErr != nil {
			return StoreAssortmentResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return StoreAssortmentResult{}, err
		}
		return StoreAssortmentResult{Assortment: assortment, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreAssortmentResult{}, fmt.Errorf("read Store Assortment update idempotency: %w", err)
	}
	current, err := readStoreAssortmentTxForUpdate(ctx, tx, storeID, productID)
	if err != nil {
		return StoreAssortmentResult{}, err
	}
	if current.Version != expectedVersion {
		return StoreAssortmentResult{}, ErrStoreAssortmentVersion
	}
	if publicationState == "published" && !current.Product.Active {
		return StoreAssortmentResult{}, ErrStoreAssortmentProductDisabled
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.store_assortments SET price_minor=$3,availability=$4,publication_state=$5,version=version+1,updated_at=clock_timestamp() WHERE store_id=$1 AND product_id=$2 AND version=$6`, storeID, productID, priceMinor, availability, publicationState, expectedVersion); err != nil {
		return StoreAssortmentResult{}, fmt.Errorf("update Store Assortment: %w", err)
	}
	updated, err := readStoreAssortmentTx(ctx, tx, storeID, productID)
	if err != nil {
		return StoreAssortmentResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_assortment_mutation_idempotency(idempotency_key,request_hash,store_id,product_id,operation,result_version) VALUES($1,$2,$3,$4,'update',$5)`, idempotencyKey, requestHash, storeID, productID, updated.Version); err != nil {
		return StoreAssortmentResult{}, err
	}
	updated.Product = current.Product
	if err := auditStoreAssortmentTx(ctx, tx, "store_assortment_updated", idempotencyKey, correlationID, actingActorID, updated, current.PublicationState, current.Version, requestHash); err != nil {
		return StoreAssortmentResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAssortmentResult{}, err
	}
	return StoreAssortmentResult{Assortment: updated}, nil
}

func lockStoreAssortmentKey(ctx context.Context, tx *sql.Tx, key string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("Store Assortment idempotency key is invalid")
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-assortment:idempotency:"+key)
	return err
}

func ensureStoreForAssortmentTx(ctx context.Context, tx *sql.Tx, storeID string) error {
	var found string
	err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE id=$1 FOR SHARE", storeID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrStoreAssortmentStoreNotFound
	}
	return err
}

func ensureActiveProductForAssortmentTx(ctx context.Context, tx *sql.Tx, productID string) error {
	var active bool
	err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.central_products WHERE id=$1 FOR SHARE", productID).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrStoreAssortmentProductNotFound
	}
	if err != nil {
		return err
	}
	if !active {
		return ErrStoreAssortmentProductDisabled
	}
	return nil
}

func auditStoreAssortmentTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, correlationID, actingActorID string, assortment StoreAssortmentRecord, fromState string, fromVersion int, requestHash string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_assortment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,store_id,product_id,from_state,to_state,expected_version,result_version,request_hash,price_minor,currency,availability) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,NULLIF($9,0),$10,$11,$12,$13,$14)`, eventType, idempotencyKey, correlationID, actingActorID, assortment.StoreID, assortment.ProductID, fromState, assortment.PublicationState, fromVersion, assortment.Version, requestHash, assortment.PriceMinor, assortment.Currency, assortment.Availability)
	return err
}

func readStoreAssortmentTx(ctx context.Context, tx *sql.Tx, storeID, productID string) (StoreAssortmentRecord, error) {
	return scanStoreAssortment(tx.QueryRowContext(ctx, storeAssortmentSelect+" WHERE a.store_id=$1 AND a.product_id=$2", storeID, productID))
}

func readStoreAssortmentTxForUpdate(ctx context.Context, tx *sql.Tx, storeID, productID string) (StoreAssortmentRecord, error) {
	assortment, err := scanStoreAssortment(tx.QueryRowContext(ctx, storeAssortmentSelect+" WHERE a.store_id=$1 AND a.product_id=$2 FOR UPDATE OF a,p", storeID, productID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreAssortmentRecord{}, ErrStoreAssortmentNotFound
	}
	return assortment, err
}

func scanStoreAssortment(row rowScanner) (StoreAssortmentRecord, error) {
	var assortment StoreAssortmentRecord
	var brand, barcode, image sql.NullString
	if err := row.Scan(&assortment.StoreID, &assortment.ProductID, &assortment.PriceMinor, &assortment.Currency, &assortment.Availability, &assortment.PublicationState, &assortment.Version, &assortment.CreatedAt, &assortment.UpdatedAt, &assortment.Product.ID, &assortment.Product.CanonicalName, &brand, &barcode, &image, &assortment.Product.SellUnit, &assortment.Product.Active, &assortment.Product.Version, &assortment.Product.CreatedAt, &assortment.Product.UpdatedAt); err != nil {
		return StoreAssortmentRecord{}, err
	}
	assortment.Product.Brand = nullableString(brand)
	assortment.Product.Barcode = nullableString(barcode)
	assortment.Product.CanonicalImageURL = nullableString(image)
	return assortment, nil
}

const storeAssortmentSelect = `SELECT a.store_id,a.product_id,a.price_minor,a.currency,a.availability,a.publication_state,a.version,a.created_at,a.updated_at,p.id,p.canonical_name,p.brand,p.barcode,p.canonical_image_url,p.sell_unit,p.active,p.version,p.created_at,p.updated_at FROM dsh.store_assortments a JOIN dsh.central_products p ON p.id=a.product_id`
