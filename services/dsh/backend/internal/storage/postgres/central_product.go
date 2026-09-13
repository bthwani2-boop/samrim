package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrCentralProductNotFound         = errors.New("central Product was not found")
	ErrCentralProductIdempotency      = errors.New("central Product idempotency key was already used with different facts")
	ErrCentralProductVersion          = errors.New("central Product version is stale")
	ErrCentralProductDuplicateBarcode = errors.New("central Product barcode is already in use")
	ErrCentralProductStoreNotFound    = errors.New("catalog store was not found")
)

type CentralProductRecord struct {
	ID                string
	CanonicalName     string
	Brand             *string
	Barcode           *string
	CanonicalImageURL *string
	SellUnit          string
	Active            bool
	Version           int
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type CentralProductInput struct {
	CanonicalName     string
	Brand             *string
	Barcode           *string
	CanonicalImageURL *string
	SellUnit          string
}

type CentralProductUpdateInput struct {
	CanonicalName     string
	Brand             *string
	Barcode           *string
	CanonicalImageURL *string
	Active            bool
}

type CentralProductResult struct {
	Product  CentralProductRecord
	Replayed bool
}

func HashCentralProductCreateRequest(input CentralProductInput) string {
	return hashProductFacts(input.CanonicalName, input.Brand, input.Barcode, input.CanonicalImageURL, input.SellUnit)
}

func HashCentralProductUpdateRequest(productID string, input CentralProductUpdateInput, expectedVersion int) string {
	return hashFacts(productID, input.CanonicalName, optionalProductFact(input.Brand), optionalProductFact(input.Barcode), optionalProductFact(input.CanonicalImageURL), fmt.Sprint(input.Active), fmt.Sprint(expectedVersion))
}

func hashProductFacts(name string, brand, barcode, image *string, sellUnit string) string {
	return hashFacts(name, optionalProductFact(brand), optionalProductFact(barcode), optionalProductFact(image), sellUnit)
}

func optionalProductFact(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func ReadCentralProduct(ctx context.Context, db *sql.DB, productID string) (CentralProductRecord, error) {
	if db == nil {
		return CentralProductRecord{}, errors.New("DSH database is nil")
	}
	productID = strings.TrimSpace(productID)
	if productID == "" {
		return CentralProductRecord{}, ErrCentralProductNotFound
	}
	product, err := scanCentralProduct(db.QueryRowContext(ctx, centralProductSelect+" WHERE id=$1", productID))
	if errors.Is(err, sql.ErrNoRows) {
		return CentralProductRecord{}, ErrCentralProductNotFound
	}
	if err != nil {
		return CentralProductRecord{}, fmt.Errorf("read central Product: %w", err)
	}
	return product, nil
}

func ListCentralProducts(ctx context.Context, db *sql.DB, query, barcode string, limit int, activeOnly bool) ([]CentralProductRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	if limit < 1 || limit > 50 {
		return nil, errors.New("central Product limit is invalid")
	}
	query = strings.TrimSpace(query)
	barcode = strings.TrimSpace(barcode)
	args := []any{}
	where := []string{}
	if activeOnly {
		where = append(where, "active=true")
	}
	if barcode != "" {
		where = append(where, fmt.Sprintf("barcode=$%d", len(args)+1))
		args = append(args, barcode)
	} else if query != "" {
		where = append(where, fmt.Sprintf("canonical_name ILIKE $%d", len(args)+1))
		args = append(args, query+"%")
	}
	whereClause := ""
	if len(where) > 0 {
		whereClause = " WHERE " + strings.Join(where, " AND ")
	}
	limitPlaceholder := len(args) + 1
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, centralProductSelect+whereClause+" ORDER BY lower(canonical_name) ASC, id ASC LIMIT $"+fmt.Sprint(limitPlaceholder), args...)
	if err != nil {
		return nil, fmt.Errorf("list central Products: %w", err)
	}
	defer func() { _ = rows.Close() }()
	products := make([]CentralProductRecord, 0)
	for rows.Next() {
		product, scanErr := scanCentralProduct(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		products = append(products, product)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read central Products: %w", err)
	}
	return products, nil
}

func CreateCentralProduct(ctx context.Context, db *sql.DB, input CentralProductInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CentralProductResult, error) {
	if db == nil {
		return CentralProductResult{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CentralProductResult{}, fmt.Errorf("begin central Product creation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCentralProductKey(ctx, tx, idempotencyKey); err != nil {
		return CentralProductResult{}, err
	}
	var storedHash, storedProductID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.central_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedProductID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CentralProductResult{}, ErrCentralProductIdempotency
		}
		product, readErr := readCentralProductTx(ctx, tx, storedProductID)
		if readErr != nil {
			return CentralProductResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CentralProductResult{}, err
		}
		return CentralProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CentralProductResult{}, fmt.Errorf("read central Product idempotency: %w", err)
	}
	if input.Barcode != nil {
		var duplicate bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.central_products WHERE barcode=$1)", *input.Barcode).Scan(&duplicate); err != nil {
			return CentralProductResult{}, err
		}
		if duplicate {
			return CentralProductResult{}, ErrCentralProductDuplicateBarcode
		}
	}
	productID, err := newID("product")
	if err != nil {
		return CentralProductResult{}, err
	}
	product, err := scanCentralProduct(tx.QueryRowContext(ctx, `INSERT INTO dsh.central_products(id,canonical_name,brand,barcode,canonical_image_url,sell_unit) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,canonical_name,brand,barcode,canonical_image_url,sell_unit,active,version,created_at,updated_at`, productID, input.CanonicalName, input.Brand, input.Barcode, input.CanonicalImageURL, input.SellUnit))
	if err != nil {
		if isUniqueViolation(err) {
			return CentralProductResult{}, ErrCentralProductDuplicateBarcode
		}
		return CentralProductResult{}, fmt.Errorf("create central Product: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.central_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'create',$4)`, idempotencyKey, requestHash, product.ID, product.Version); err != nil {
		return CentralProductResult{}, err
	}
	if err := auditCentralProductTx(ctx, tx, "central_product_created", idempotencyKey, correlationID, actingActorID, product, 0, requestHash); err != nil {
		return CentralProductResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CentralProductResult{}, err
	}
	return CentralProductResult{Product: product}, nil
}

func UpdateCentralProduct(ctx context.Context, db *sql.DB, productID string, input CentralProductUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CentralProductResult, error) {
	if db == nil {
		return CentralProductResult{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CentralProductResult{}, fmt.Errorf("begin central Product update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockCentralProductKey(ctx, tx, idempotencyKey); err != nil {
		return CentralProductResult{}, err
	}
	var storedHash, storedProductID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.central_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedProductID, &operation)
	if err == nil {
		if storedHash != requestHash || storedProductID != productID || operation != "update" {
			return CentralProductResult{}, ErrCentralProductIdempotency
		}
		product, readErr := readCentralProductTx(ctx, tx, productID)
		if readErr != nil {
			return CentralProductResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CentralProductResult{}, err
		}
		return CentralProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CentralProductResult{}, fmt.Errorf("read central Product update idempotency: %w", err)
	}
	current, err := readCentralProductTxForUpdate(ctx, tx, productID)
	if err != nil {
		return CentralProductResult{}, err
	}
	if current.Version != expectedVersion {
		return CentralProductResult{}, ErrCentralProductVersion
	}
	if input.Barcode != nil {
		var duplicate bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.central_products WHERE barcode=$1 AND id<>$2)", *input.Barcode, productID).Scan(&duplicate); err != nil {
			return CentralProductResult{}, err
		}
		if duplicate {
			return CentralProductResult{}, ErrCentralProductDuplicateBarcode
		}
	}
	updated, err := scanCentralProduct(tx.QueryRowContext(ctx, `UPDATE dsh.central_products SET canonical_name=$2,brand=$3,barcode=$4,canonical_image_url=$5,active=$6,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$7 RETURNING id,canonical_name,brand,barcode,canonical_image_url,sell_unit,active,version,created_at,updated_at`, productID, input.CanonicalName, input.Brand, input.Barcode, input.CanonicalImageURL, input.Active, expectedVersion))
	if err != nil {
		if isUniqueViolation(err) {
			return CentralProductResult{}, ErrCentralProductDuplicateBarcode
		}
		if errors.Is(err, sql.ErrNoRows) {
			return CentralProductResult{}, ErrCentralProductVersion
		}
		return CentralProductResult{}, fmt.Errorf("update central Product: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.central_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'update',$4)`, idempotencyKey, requestHash, productID, updated.Version); err != nil {
		return CentralProductResult{}, err
	}
	if err := auditCentralProductTx(ctx, tx, "central_product_updated", idempotencyKey, correlationID, actingActorID, updated, current.Version, requestHash); err != nil {
		return CentralProductResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CentralProductResult{}, err
	}
	return CentralProductResult{Product: updated}, nil
}

func lockCentralProductKey(ctx context.Context, tx *sql.Tx, key string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("central Product idempotency key is invalid")
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:central-product:idempotency:"+key)
	return err
}

func auditCentralProductTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, correlationID, actingActorID string, product CentralProductRecord, fromVersion int, requestHash string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.central_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,barcode,canonical_image_url,sell_unit,active) VALUES($1,$2,$3,$4,$5,NULLIF($6,0),$7,$8,$9,$10,$11,$12,$13,$14)`, eventType, idempotencyKey, correlationID, actingActorID, product.ID, fromVersion, product.Version, requestHash, product.CanonicalName, product.Brand, product.Barcode, product.CanonicalImageURL, product.SellUnit, product.Active)
	return err
}

const centralProductSelect = `SELECT id,canonical_name,brand,barcode,canonical_image_url,sell_unit,active,version,created_at,updated_at FROM dsh.central_products`

func readCentralProductTx(ctx context.Context, tx *sql.Tx, productID string) (CentralProductRecord, error) {
	return scanCentralProduct(tx.QueryRowContext(ctx, centralProductSelect+" WHERE id=$1", productID))
}

func readCentralProductTxForUpdate(ctx context.Context, tx *sql.Tx, productID string) (CentralProductRecord, error) {
	product, err := scanCentralProduct(tx.QueryRowContext(ctx, centralProductSelect+" WHERE id=$1 FOR UPDATE", productID))
	if errors.Is(err, sql.ErrNoRows) {
		return CentralProductRecord{}, ErrCentralProductNotFound
	}
	return product, err
}

func scanCentralProduct(row rowScanner) (CentralProductRecord, error) {
	var product CentralProductRecord
	var brand, barcode, image sql.NullString
	if err := row.Scan(&product.ID, &product.CanonicalName, &brand, &barcode, &image, &product.SellUnit, &product.Active, &product.Version, &product.CreatedAt, &product.UpdatedAt); err != nil {
		return CentralProductRecord{}, err
	}
	product.Brand = nullableString(brand)
	product.Barcode = nullableString(barcode)
	product.CanonicalImageURL = nullableString(image)
	return product, nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	copy := value.String
	return &copy
}

func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23505"
}
