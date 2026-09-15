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
	ErrCatalogProductNotFound       = errors.New("catalog Product was not found")
	ErrCatalogVariantNotFound       = errors.New("catalog Product Variant was not found")
	ErrCatalogOfferNotFound         = errors.New("catalog StoreOffer was not found")
	ErrCatalogVerticalNotFound      = errors.New("commerce vertical was not found")
	ErrCatalogCategoryNotFound      = errors.New("catalog category was not found")
	ErrCatalogIdempotencyConflict   = errors.New("catalog idempotency key was already used with different facts")
	ErrCatalogVersionConflict       = errors.New("catalog version is stale")
	ErrCatalogDuplicateIdentifier   = errors.New("catalog identifier is already assigned")
	ErrCatalogIdentifierInvalid     = errors.New("catalog identifier is invalid")
	ErrCatalogOfferAlreadyExists    = errors.New("StoreOffer already exists for this Store and Variant")
	ErrCatalogOfferInvalidState     = errors.New("StoreOffer publication state is invalid")
	ErrCatalogOfferProductDisabled  = errors.New("disabled Product or Variant cannot be published")
	ErrCatalogOfferStoreNotFound    = errors.New("catalog Store was not found")
	ErrCatalogProductScopeForbidden = errors.New("Partner cannot directly create or mutate a Shared Product")
)

type CommerceVerticalRecord struct {
	ID        string
	NameAr    string
	NameEn    string
	Active    bool
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

type CatalogCategoryRecord struct {
	ID               string
	VerticalID       string
	ParentCategoryID string
	NameAr           string
	NameEn           string
	Active           bool
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type CatalogIdentifierRecord struct {
	Type  string
	Value string
}

type CatalogMediaRecord struct {
	URI     string
	Role    string
	Ordinal int
}

type CatalogVariantRecord struct {
	ID          string
	ProductID   string
	Title       string
	SellUnit    string
	Active      bool
	Version     int
	Identifiers []CatalogIdentifierRecord
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type CatalogProductRecord struct {
	ID            string
	VerticalID    string
	Scope         string
	CanonicalName string
	Brand         *string
	Active        bool
	Version       int
	Variants      []CatalogVariantRecord
	CategoryIDs   []string
	Media         []CatalogMediaRecord
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CatalogStoreOfferRecord struct {
	ID               string
	StoreID          string
	VariantID        string
	Product          CatalogProductRecord
	Variant          CatalogVariantRecord
	PriceMinor       int64
	Currency         string
	QuantityPolicy   string
	PricingBasis     string
	InventoryPolicy  string
	Availability     bool
	PublicationState string
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type CatalogProductInput struct {
	ID              string
	VerticalID      string
	Scope           string
	CanonicalName   string
	Brand           *string
	SellUnit        string
	VariantTitle    string
	CategoryIDs     []string
	IdentifierType  string
	IdentifierValue string
	ImageURI        string
}

type CatalogProductUpdateInput struct {
	VerticalID    string
	Scope         string
	CanonicalName string
	Brand         *string
	Active        bool
}

type CatalogProductResult struct {
	Product  CatalogProductRecord
	Replayed bool
}
type CatalogStoreOfferResult struct {
	Offer    CatalogStoreOfferRecord
	Replayed bool
}
type CommerceVerticalResult struct {
	Vertical CommerceVerticalRecord
	Replayed bool
}

func HashCatalogProductCreateRequest(input CatalogProductInput) string {
	return hashFacts(input.VerticalID, input.Scope, input.CanonicalName, optionalProductFact(input.Brand), input.SellUnit, input.VariantTitle, strings.Join(input.CategoryIDs, ","), input.IdentifierType, input.IdentifierValue, input.ImageURI)
}

func HashCatalogVerticalCreateRequest(item CommerceVerticalRecord) string {
	return hashFacts("vertical", strings.TrimSpace(item.ID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active))
}

func HashCatalogCategoryCreateRequest(item CatalogCategoryRecord) string {
	return hashFacts("category", strings.TrimSpace(item.ID), strings.TrimSpace(item.VerticalID), strings.TrimSpace(item.ParentCategoryID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active))
}

func HashCatalogProductUpdateRequest(productID string, input CatalogProductUpdateInput, expectedVersion int) string {
	return hashFacts(productID, input.VerticalID, input.Scope, input.CanonicalName, optionalProductFact(input.Brand), strconv.FormatBool(input.Active), strconv.Itoa(expectedVersion))
}

func HashCatalogOfferCreateRequest(storeID, variantID string, priceMinor int64, quantityPolicy, pricingBasis string) string {
	return hashFacts(strings.TrimSpace(storeID), strings.TrimSpace(variantID), strconv.FormatInt(priceMinor, 10), strings.TrimSpace(quantityPolicy), strings.TrimSpace(pricingBasis))
}

func HashCatalogOfferUpdateRequest(offerID string, priceMinor int64, availability bool, publicationState string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(offerID), strconv.FormatInt(priceMinor, 10), strconv.FormatBool(availability), strings.TrimSpace(publicationState), strconv.Itoa(expectedVersion))
}

func CreateCommerceVertical(ctx context.Context, db *sql.DB, item CommerceVerticalRecord, idempotencyKey, requestHash string) (CommerceVerticalResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CommerceVerticalResult{}, err
	}
	var entityType, entityID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&entityType, &entityID, &storedHash)
	if err == nil {
		if storedHash != requestHash || entityType != "vertical" {
			return CommerceVerticalResult{}, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCommerceVerticalTx(ctx, tx, entityID)
		if readErr != nil {
			return CommerceVerticalResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CommerceVerticalResult{}, err
		}
		return CommerceVerticalResult{Vertical: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_verticals(id,name_ar,name_en,active) VALUES($1,$2,$3,$4)`, item.ID, item.NameAr, item.NameEn, item.Active); err != nil {
		if isUniqueViolation(err) {
			return CommerceVerticalResult{}, ErrCatalogIdempotencyConflict
		}
		return CommerceVerticalResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'vertical',$3)`, idempotencyKey, requestHash, item.ID); err != nil {
		return CommerceVerticalResult{}, err
	}
	result, err := readCommerceVerticalTx(ctx, tx, item.ID)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CommerceVerticalResult{}, err
	}
	return CommerceVerticalResult{Vertical: result}, nil
}

func CreateCatalogCategory(ctx context.Context, db *sql.DB, item CatalogCategoryRecord, idempotencyKey, requestHash string) (CatalogCategoryRecord, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CatalogCategoryRecord{}, err
	}
	var entityType, entityID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&entityType, &entityID, &storedHash)
	if err == nil {
		if storedHash != requestHash || entityType != "category" {
			return CatalogCategoryRecord{}, ErrCatalogIdempotencyConflict
		}
		item, readErr := readCatalogCategoryTx(ctx, tx, entityID)
		if readErr != nil {
			return CatalogCategoryRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogCategoryRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_categories(id,vertical_id,parent_category_id,name_ar,name_en,active) VALUES($1,$2,NULLIF($3,''),$4,$5,$6)`, item.ID, item.VerticalID, item.ParentCategoryID, item.NameAr, item.NameEn, item.Active); err != nil {
		return CatalogCategoryRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'category',$3)`, idempotencyKey, requestHash, item.ID); err != nil {
		return CatalogCategoryRecord{}, err
	}
	result, err := readCatalogCategoryTx(ctx, tx, item.ID)
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogCategoryRecord{}, err
	}
	return result, nil
}

func readCommerceVerticalTx(ctx context.Context, tx *sql.Tx, id string) (CommerceVerticalRecord, error) {
	var item CommerceVerticalRecord
	err := tx.QueryRowContext(ctx, "SELECT id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.commerce_verticals WHERE id=$1", id).Scan(&item.ID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}
func readCatalogCategoryTx(ctx context.Context, tx *sql.Tx, id string) (CatalogCategoryRecord, error) {
	var item CatalogCategoryRecord
	var parent sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT id,vertical_id,parent_category_id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.catalog_categories WHERE id=$1", id).Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if parent.Valid {
		item.ParentCategoryID = parent.String
	}
	return item, err
}

func ListCommerceVerticals(ctx context.Context, db *sql.DB, activeOnly bool) ([]CommerceVerticalRecord, error) {
	where := ""
	if activeOnly {
		where = " WHERE active=true"
	}
	rows, err := db.QueryContext(ctx, "SELECT id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.commerce_verticals"+where+" ORDER BY lower(name_en),id")
	if err != nil {
		return nil, fmt.Errorf("list commerce verticals: %w", err)
	}
	defer rows.Close()
	items := make([]CommerceVerticalRecord, 0)
	for rows.Next() {
		var item CommerceVerticalRecord
		if err := rows.Scan(&item.ID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ReadCommerceVertical(ctx context.Context, db *sql.DB, id string) (CommerceVerticalRecord, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return CommerceVerticalRecord{}, ErrCatalogVerticalNotFound
	}
	var item CommerceVerticalRecord
	err := db.QueryRowContext(ctx, "SELECT id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.commerce_verticals WHERE id=$1", id).Scan(&item.ID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalRecord{}, ErrCatalogVerticalNotFound
	}
	if err != nil {
		return CommerceVerticalRecord{}, err
	}
	return item, nil
}

func ListCatalogCategories(ctx context.Context, db *sql.DB, verticalID string, activeOnly bool) ([]CatalogCategoryRecord, error) {
	args := []any{strings.TrimSpace(verticalID)}
	where := " WHERE vertical_id=$1"
	if activeOnly {
		where += " AND active=true"
	}
	rows, err := db.QueryContext(ctx, "SELECT id,vertical_id,parent_category_id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.catalog_categories"+where+" ORDER BY parent_category_id NULLS FIRST,lower(name_en),id", args...)
	if err != nil {
		return nil, fmt.Errorf("list catalog categories: %w", err)
	}
	defer rows.Close()
	items := make([]CatalogCategoryRecord, 0)
	for rows.Next() {
		var item CatalogCategoryRecord
		var parent sql.NullString
		if err := rows.Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if parent.Valid {
			item.ParentCategoryID = parent.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ReadCatalogProduct(ctx context.Context, db *sql.DB, productID string) (CatalogProductRecord, error) {
	product, err := readCatalogProductRow(db.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1", strings.TrimSpace(productID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductRecord{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductRecord{}, fmt.Errorf("read catalog Product: %w", err)
	}
	return hydrateCatalogProduct(ctx, db, product)
}

func ListCatalogProducts(ctx context.Context, db *sql.DB, query, verticalID string, activeOnly bool, limit int) ([]CatalogProductRecord, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("catalog Product limit is invalid")
	}
	args := make([]any, 0, 3)
	where := make([]string, 0, 3)
	if activeOnly {
		where = append(where, "p.active=true")
	}
	if strings.TrimSpace(verticalID) != "" {
		args = append(args, strings.TrimSpace(verticalID))
		where = append(where, fmt.Sprintf("p.vertical_id=$%d", len(args)))
	}
	if strings.TrimSpace(query) != "" {
		args = append(args, strings.TrimSpace(query)+"%")
		where = append(where, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, catalogProductSelect+clause+fmt.Sprintf(" ORDER BY lower(p.canonical_name),p.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("list catalog Products: %w", err)
	}
	items := make([]CatalogProductRecord, 0)
	for rows.Next() {
		product, scanErr := readCatalogProductRow(rows)
		if scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		items = append(items, product)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index], err = hydrateCatalogProduct(ctx, db, items[index])
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func CreateCatalogProduct(ctx context.Context, db *sql.DB, input CatalogProductInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return CatalogProductResult{}, errors.New("catalog Product idempotency key is invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-product:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.catalog_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, readErr := readCatalogProductTx(ctx, tx, storedID)
		if readErr != nil {
			return CatalogProductResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogProductResult{}, err
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	if err := validateCatalogProductFactsTx(ctx, tx, input); err != nil {
		return CatalogProductResult{}, err
	}
	productID := strings.TrimSpace(input.ID)
	if productID == "" {
		productID, err = newID("product")
		if err != nil {
			return CatalogProductResult{}, err
		}
	}
	variantID := "variant_default_" + productID
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,brand) VALUES($1,$2,$3,$4,$5)`, productID, input.VerticalID, input.Scope, input.CanonicalName, input.Brand); err != nil {
		if isUniqueViolation(err) {
			return CatalogProductResult{}, ErrCatalogDuplicateIdentifier
		}
		return CatalogProductResult{}, fmt.Errorf("create catalog Product: %w", err)
	}
	title := strings.TrimSpace(input.VariantTitle)
	if title == "" {
		title = "الافتراضي"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,sell_unit) VALUES($1,$2,$3,$4)`, variantID, productID, title, input.SellUnit); err != nil {
		return CatalogProductResult{}, err
	}
	for _, categoryID := range input.CategoryIDs {
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES($1,$2)", productID, categoryID); err != nil {
			return CatalogProductResult{}, err
		}
	}
	if strings.TrimSpace(input.IdentifierValue) != "" {
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value) VALUES($1,$2,$3)", variantID, input.IdentifierType, input.IdentifierValue); err != nil {
			if isUniqueViolation(err) {
				return CatalogProductResult{}, ErrCatalogDuplicateIdentifier
			}
			return CatalogProductResult{}, err
		}
	}
	if strings.TrimSpace(input.ImageURI) != "" {
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media(product_id,uri,media_role,ordinal) VALUES($1,$2,'primary',0)", productID, input.ImageURI); err != nil {
			return CatalogProductResult{}, err
		}
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'create',$4)`, idempotencyKey, requestHash, productID, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_created',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10)`, idempotencyKey, correlationID, actingActorID, product.ID, product.Version, requestHash, product.CanonicalName, product.Brand, product.VerticalID, product.Scope); err != nil {
		return CatalogProductResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func UpdateCatalogProduct(ctx context.Context, db *sql.DB, productID string, input CatalogProductUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	if expectedVersion < 1 {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-product:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.catalog_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != productID || operation != "update" {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, readErr := readCatalogProductTx(ctx, tx, productID)
		if readErr != nil {
			return CatalogProductResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogProductResult{}, err
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	current, err := readCatalogProductTxForUpdate(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	if input.VerticalID != current.VerticalID || input.Scope != current.Scope {
		return CatalogProductResult{}, errors.New("Product identity fields are immutable")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.catalog_products SET canonical_name=$2,brand=$3,active=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$5`, productID, input.CanonicalName, input.Brand, input.Active, expectedVersion); err != nil {
		return CatalogProductResult{}, err
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'update',$4)`, idempotencyKey, requestHash, productID, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, idempotencyKey, correlationID, actingActorID, product.ID, current.Version, product.Version, requestHash, product.CanonicalName, product.Brand, product.VerticalID, product.Scope); err != nil {
		return CatalogProductResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func ListCatalogOffers(ctx context.Context, db *sql.DB, storeID string, publicOnly bool) ([]CatalogStoreOfferRecord, error) {
	where := []string{"o.store_id=$1"}
	args := []any{strings.TrimSpace(storeID)}
	if publicOnly {
		where = append(where, customerVisibleOfferConditions()...)
	}
	rows, err := db.QueryContext(ctx, catalogOfferSelect+" WHERE "+strings.Join(where, " AND ")+" ORDER BY o.created_at,o.id", args...)
	if err != nil {
		return nil, fmt.Errorf("list StoreOffers: %w", err)
	}
	defer rows.Close()
	items := make([]CatalogStoreOfferRecord, 0)
	for rows.Next() {
		item, scanErr := scanCatalogOffer(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ListCatalogOffersForStores(ctx context.Context, db *sql.DB, storeIDs []string, publicOnly bool) (map[string][]CatalogStoreOfferRecord, error) {
	result := make(map[string][]CatalogStoreOfferRecord, len(storeIDs))
	for _, storeID := range storeIDs {
		items, err := ListCatalogOffers(ctx, db, storeID, publicOnly)
		if err != nil {
			return nil, err
		}
		result[storeID] = items
	}
	return result, nil
}

func HasPublishableCatalog(ctx context.Context, db *sql.DB, storeID string) (bool, error) {
	var ready bool
	conditions := append([]string{"o.store_id=$1"}, publishableCatalogOfferConditionsForAliases("o", "v", "p", "s")...)
	err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM dsh.catalog_store_offers o
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE `+strings.Join(conditions, " AND ")+`
	)`, strings.TrimSpace(storeID)).Scan(&ready)
	return ready, err
}

func ReadCatalogOffer(ctx context.Context, db *sql.DB, offerID string) (CatalogStoreOfferRecord, error) {
	item, err := scanCatalogOffer(db.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", strings.TrimSpace(offerID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferRecord{}, ErrCatalogOfferNotFound
	}
	if err != nil {
		return CatalogStoreOfferRecord{}, err
	}
	return item, nil
}

func CreateCatalogOffer(ctx context.Context, db *sql.DB, storeID, variantID string, priceMinor int64, quantityPolicy, pricingBasis, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogStoreOfferResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-offer:idempotency:"+idempotencyKey); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	var storedHash, storedOfferID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,offer_id,operation FROM dsh.catalog_store_offer_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOfferID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CatalogStoreOfferResult{}, ErrCatalogIdempotencyConflict
		}
		offer, readErr := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", storedOfferID))
		if readErr != nil {
			return CatalogStoreOfferResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogStoreOfferResult{}, err
		}
		return CatalogStoreOfferResult{Offer: offer, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, err
	}
	if priceMinor <= 0 {
		return CatalogStoreOfferResult{}, errors.New("StoreOffer price is invalid")
	}
	var storeVertical, productVertical, productScope, productID, sellUnit string
	if err := tx.QueryRowContext(ctx, `SELECT s.primary_vertical_id,p.vertical_id,p.scope,p.id,v.sell_unit FROM dsh.stores s JOIN dsh.catalog_product_variants v ON v.id=$2 JOIN dsh.catalog_products p ON p.id=v.product_id WHERE s.id=$1 FOR SHARE`, storeID, variantID).Scan(&storeVertical, &productVertical, &productScope, &productID, &sellUnit); errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, ErrCatalogVariantNotFound
	} else if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if storeVertical == "" || productVertical == "" || storeVertical != productVertical {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if productScope == "SHARED" && storeVertical == "" {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if quantityPolicy != "DISCRETE" && quantityPolicy != "MEASURED" {
		return CatalogStoreOfferResult{}, errors.New("quantity policy is invalid")
	}
	if pricingBasis != "PER_UNIT" && pricingBasis != "PER_KILOGRAM" {
		return CatalogStoreOfferResult{}, errors.New("pricing basis is invalid")
	}
	if sellUnit == "piece" && (quantityPolicy != "DISCRETE" || pricingBasis != "PER_UNIT") {
		return CatalogStoreOfferResult{}, errors.New("piece Variant requires discrete per-unit pricing")
	}
	if sellUnit == "kg" && (quantityPolicy != "MEASURED" || pricingBasis != "PER_KILOGRAM") {
		return CatalogStoreOfferResult{}, errors.New("kg Variant requires measured per-kilogram pricing")
	}
	offerID, err := newID("offer")
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis) VALUES($1,$2,$3,$4,$5,$6)`, offerID, storeID, variantID, priceMinor, quantityPolicy, pricingBasis); err != nil {
		if isUniqueViolation(err) {
			return CatalogStoreOfferResult{}, ErrCatalogOfferAlreadyExists
		}
		return CatalogStoreOfferResult{}, err
	}
	offer, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key,request_hash,offer_id,operation,result_version) VALUES($1,$2,$3,'create',$4)`, idempotencyKey, requestHash, offerID, offer.Version); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offer_audit(event_type,idempotency_key,correlation_id,acting_actor_id,offer_id,from_state,to_state,result_version,request_hash,store_id,variant_id,price_minor,currency,availability) VALUES('catalog_store_offer_created',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12)`, idempotencyKey, correlationID, actingActorID, offer.ID, offer.PublicationState, offer.Version, requestHash, offer.StoreID, offer.VariantID, offer.PriceMinor, offer.Currency, offer.Availability); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	return CatalogStoreOfferResult{Offer: offer}, nil
}

func UpdateCatalogOffer(ctx context.Context, db *sql.DB, offerID string, priceMinor int64, availability bool, publicationState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogStoreOfferResult, error) {
	if publicationState != "draft" && publicationState != "published" && publicationState != "hidden" {
		return CatalogStoreOfferResult{}, ErrCatalogOfferInvalidState
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-offer:idempotency:"+idempotencyKey); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	var storedHash, storedOfferID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,offer_id,operation FROM dsh.catalog_store_offer_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOfferID, &operation)
	if err == nil {
		if storedHash != requestHash || storedOfferID != offerID || operation != "update" {
			return CatalogStoreOfferResult{}, ErrCatalogIdempotencyConflict
		}
		offer, readErr := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
		if readErr != nil {
			return CatalogStoreOfferResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CatalogStoreOfferResult{}, err
		}
		return CatalogStoreOfferResult{Offer: offer, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, err
	}
	current, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1 FOR UPDATE OF o", offerID))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, ErrCatalogOfferNotFound
	}
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogStoreOfferResult{}, ErrCatalogVersionConflict
	}
	if priceMinor <= 0 {
		return CatalogStoreOfferResult{}, errors.New("StoreOffer price is invalid")
	}
	if publicationState == "published" && (!current.Product.Active || !current.Variant.Active || current.Product.VerticalID == "") {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.catalog_store_offers SET price_minor=$2,availability=$3,publication_state=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$5`, offerID, priceMinor, availability, publicationState, expectedVersion); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	updated, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key,request_hash,offer_id,operation,result_version) VALUES($1,$2,$3,'update',$4)`, idempotencyKey, requestHash, offerID, updated.Version); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offer_audit(event_type,idempotency_key,correlation_id,acting_actor_id,offer_id,from_state,to_state,expected_version,result_version,request_hash,store_id,variant_id,price_minor,currency,availability) VALUES('catalog_store_offer_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, idempotencyKey, correlationID, actingActorID, offerID, current.PublicationState, updated.PublicationState, expectedVersion, updated.Version, requestHash, updated.StoreID, updated.VariantID, updated.PriceMinor, updated.Currency, updated.Availability); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	return CatalogStoreOfferResult{Offer: updated}, nil
}

func validateCatalogProductFactsTx(ctx context.Context, tx *sql.Tx, input CatalogProductInput) error {
	if strings.TrimSpace(input.VerticalID) == "" || strings.TrimSpace(input.CanonicalName) == "" || strings.TrimSpace(input.SellUnit) == "" {
		return errors.New("catalog Product facts are invalid")
	}
	if input.Scope != "SHARED" && input.Scope != "STORE_SCOPED" {
		return errors.New("catalog Product scope is invalid")
	}
	if input.SellUnit != "piece" && input.SellUnit != "kg" {
		return errors.New("catalog Product sell unit is invalid")
	}
	if len(input.CategoryIDs) == 0 {
		return errors.New("a catalog Product requires at least one Category")
	}
	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1", input.VerticalID).Scan(&active); errors.Is(err, sql.ErrNoRows) {
		return ErrCatalogVerticalNotFound
	} else if err != nil {
		return err
	} else if !active {
		return ErrCatalogVerticalNotFound
	}
	for _, categoryID := range input.CategoryIDs {
		var categoryVertical string
		if err := tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1 AND active=true", categoryID).Scan(&categoryVertical); errors.Is(err, sql.ErrNoRows) {
			return ErrCatalogCategoryNotFound
		} else if err != nil {
			return err
		} else if categoryVertical != input.VerticalID {
			return ErrCatalogCategoryNotFound
		}
	}
	if input.IdentifierValue != "" && (input.IdentifierType != "GTIN" && input.IdentifierType != "EAN" && input.IdentifierType != "UPC" && input.IdentifierType != "SKU") {
		return ErrCatalogIdentifierInvalid
	}
	return nil
}

const catalogProductSelect = `SELECT p.id,p.vertical_id,p.scope,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at FROM dsh.catalog_products p`

const catalogOfferSelect = `SELECT o.id,o.store_id,o.variant_id,o.price_minor,o.currency,o.quantity_policy,o.pricing_basis,o.inventory_policy,o.availability,o.publication_state,o.version,o.created_at,o.updated_at,v.id,v.product_id,v.title,v.sell_unit,v.active,v.version,v.created_at,v.updated_at,p.id,p.vertical_id,p.scope,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id JOIN dsh.stores s ON s.id=o.store_id`

func readCatalogProductRow(row rowScanner) (CatalogProductRecord, error) {
	var item CatalogProductRecord
	var vertical, brand sql.NullString
	if err := row.Scan(&item.ID, &vertical, &item.Scope, &item.CanonicalName, &brand, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return item, err
	}
	if vertical.Valid {
		item.VerticalID = vertical.String
	}
	item.Brand = nullableString(brand)
	return item, nil
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func hydrateCatalogProduct(ctx context.Context, db queryer, item CatalogProductRecord) (CatalogProductRecord, error) {
	variantRows, err := db.QueryContext(ctx, "SELECT id,product_id,title,sell_unit,active,version,created_at,updated_at FROM dsh.catalog_product_variants WHERE product_id=$1 ORDER BY id", item.ID)
	if err != nil {
		return item, err
	}
	defer variantRows.Close()
	item.Variants = make([]CatalogVariantRecord, 0)
	for variantRows.Next() {
		var v CatalogVariantRecord
		if err := variantRows.Scan(&v.ID, &v.ProductID, &v.Title, &v.SellUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return item, err
		}
		item.Variants = append(item.Variants, v)
	}
	if err := variantRows.Err(); err != nil {
		return item, err
	}
	if err := variantRows.Close(); err != nil {
		return item, err
	}
	for index := range item.Variants {
		item.Variants[index].Identifiers, err = listCatalogIdentifiers(ctx, db, item.Variants[index].ID)
		if err != nil {
			return item, err
		}
	}
	catRows, err := db.QueryContext(ctx, "SELECT category_id FROM dsh.catalog_product_categories WHERE product_id=$1 ORDER BY category_id", item.ID)
	if err != nil {
		return item, err
	}
	defer catRows.Close()
	item.CategoryIDs = make([]string, 0)
	for catRows.Next() {
		var id string
		if err := catRows.Scan(&id); err != nil {
			return item, err
		}
		item.CategoryIDs = append(item.CategoryIDs, id)
	}
	mediaRows, err := db.QueryContext(ctx, "SELECT uri,media_role,ordinal FROM dsh.catalog_media WHERE product_id=$1 ORDER BY ordinal", item.ID)
	if err != nil {
		return item, err
	}
	defer mediaRows.Close()
	item.Media = make([]CatalogMediaRecord, 0)
	for mediaRows.Next() {
		var m CatalogMediaRecord
		if err := mediaRows.Scan(&m.URI, &m.Role, &m.Ordinal); err != nil {
			return item, err
		}
		item.Media = append(item.Media, m)
	}
	return item, mediaRows.Err()
}

func readCatalogProductTx(ctx context.Context, tx *sql.Tx, productID string) (CatalogProductRecord, error) {
	product, err := readCatalogProductRow(tx.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1", productID))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductRecord{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductRecord{}, err
	}
	return hydrateCatalogProduct(ctx, tx, product)
}

func readCatalogProductTxForUpdate(ctx context.Context, tx *sql.Tx, productID string) (CatalogProductRecord, error) {
	return readCatalogProductTx(ctx, tx, productID)
}

func listCatalogIdentifiers(ctx context.Context, db queryer, variantID string) ([]CatalogIdentifierRecord, error) {
	rows, err := db.QueryContext(ctx, "SELECT identifier_type,identifier_value FROM dsh.catalog_variant_identifiers WHERE variant_id=$1 ORDER BY id", variantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogIdentifierRecord, 0)
	for rows.Next() {
		var item CatalogIdentifierRecord
		if err := rows.Scan(&item.Type, &item.Value); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanCatalogOffer(row rowScanner) (CatalogStoreOfferRecord, error) {
	var item CatalogStoreOfferRecord
	var variant CatalogVariantRecord
	var product CatalogProductRecord
	var productBrand, productVertical sql.NullString
	if err := row.Scan(&item.ID, &item.StoreID, &item.VariantID, &item.PriceMinor, &item.Currency, &item.QuantityPolicy, &item.PricingBasis, &item.InventoryPolicy, &item.Availability, &item.PublicationState, &item.Version, &item.CreatedAt, &item.UpdatedAt, &variant.ID, &variant.ProductID, &variant.Title, &variant.SellUnit, &variant.Active, &variant.Version, &variant.CreatedAt, &variant.UpdatedAt, &product.ID, &productVertical, &product.Scope, &product.CanonicalName, &productBrand, &product.Active, &product.Version, &product.CreatedAt, &product.UpdatedAt); err != nil {
		return item, err
	}
	if productVertical.Valid {
		product.VerticalID = productVertical.String
	}
	product.Brand = nullableString(productBrand)
	item.Product = product
	item.Variant = variant
	return item, nil
}

func optionalProductFact(value *string) string {
	if value == nil {
		return ""
	}
	return *value
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
