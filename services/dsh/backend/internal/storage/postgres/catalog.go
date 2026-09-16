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
	ErrCatalogOfferQuantityInvalid  = errors.New("StoreOffer quantity policy is invalid")
	ErrCatalogOfferStoreNotFound    = errors.New("catalog Store was not found")
	ErrCatalogProductScopeForbidden = errors.New("Partner cannot directly create or mutate a Shared Product")
	ErrCatalogProductOwnership      = errors.New("Store-scoped Product ownership is invalid")
)

type CommerceVerticalRecord struct {
	ID, NameAr, NameEn   string
	Active               bool
	Version              int
	CreatedAt, UpdatedAt time.Time
}
type CatalogCategoryRecord struct {
	ID, VerticalID, ParentCategoryID, NameAr, NameEn string
	Active                                           bool
	Version                                          int
	CreatedAt, UpdatedAt                             time.Time
}
type CatalogIdentifierRecord struct{ Type, Value string }
type CatalogMediaRecord struct {
	URI, Role string
	Ordinal   int
}

type CatalogAttributeValueRecord struct {
	AttributeID, Code, ValueKind string
	TextValue                    *string
	IntegerValue                 *int64
	DecimalValue                 *string
	BooleanValue                 *bool
	EnumValue                    *string
	DateValue                    *string
	MeasurementUnit              *string
}
type CatalogAttributeRuleRecord struct {
	CategoryID, AttributeID, Code, NameAr, ValueKind string
	Required, Filterable, VariantAxis                bool
	Version                                          int
}

type CatalogVariantRecord struct {
	ID, ProductID, Title, MeasurementKind, BaseUnit string
	Active                                          bool
	Version                                         int
	Identifiers                                     []CatalogIdentifierRecord
	Attributes                                      []CatalogAttributeValueRecord
	CreatedAt, UpdatedAt                            time.Time
}
type CatalogProductRecord struct {
	ID, VerticalID, Scope, StoreID, CanonicalName string
	Brand                                         *string
	Active                                        bool
	Version                                       int
	Variants                                      []CatalogVariantRecord
	CategoryIDs                                   []string
	Attributes                                    []CatalogAttributeValueRecord
	Media                                         []CatalogMediaRecord
	CreatedAt, UpdatedAt                          time.Time
}
type CatalogModifierOptionRecord struct {
	ID, GroupID, NameAr string
	PriceDeltaMinor     int64
	Availability        bool
	Ordinal, Version    int
}
type CatalogModifierGroupRecord struct {
	ID, StoreID, NameAr          string
	Required                     bool
	MinSelections, MaxSelections int
	Active                       bool
	Version                      int
	Options                      []CatalogModifierOptionRecord
}
type CatalogStorefrontSectionRecord struct {
	ID, StoreID, NameAr string
	NameEn              *string
	Ordinal             int
	Active              bool
	Version             int
	OfferIDs            []string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}
type CatalogStoreOfferRecord struct {
	ID, StoreID, VariantID                                                    string
	Product                                                                   CatalogProductRecord
	Variant                                                                   CatalogVariantRecord
	PriceMinor                                                                int64
	Currency, QuantityPolicy, PricingBasis, InventoryPolicy, PublicationState string
	QuantityMinBaseUnits, QuantityMaxBaseUnits, QuantityStepBaseUnits         *int64
	PricingUnitBaseUnits                                                      int64
	Availability                                                              bool
	Version                                                                   int
	ModifierGroups                                                            []CatalogModifierGroupRecord
	CreatedAt, UpdatedAt                                                      time.Time
}

type CatalogProductInput struct {
	ID, VerticalID, Scope, StoreID, CanonicalName string
	Brand                                         *string
	VariantTitle, MeasurementKind, BaseUnit       string
	CategoryIDs                                   []string
	IdentifierType, IdentifierValue, ImageURI     string
}
type CatalogProductUpdateInput struct {
	VerticalID, Scope, StoreID, CanonicalName string
	Brand                                     *string
	Active                                    bool
}
type CatalogVariantInput struct {
	ID, ProductID, Title, MeasurementKind, BaseUnit string
	Active                                          bool
	IdentifierType, IdentifierValue                 string
}
type CatalogOfferInput struct {
	StoreID, VariantID                                                string
	PriceMinor                                                        int64
	QuantityPolicy                                                    string
	QuantityMinBaseUnits, QuantityMaxBaseUnits, QuantityStepBaseUnits int64
	PricingBasis                                                      string
	PricingUnitBaseUnits                                              int64
}
type CatalogOfferUpdateInput struct {
	PriceMinor                                                        int64
	Availability                                                      bool
	PublicationState, QuantityPolicy                                  string
	QuantityMinBaseUnits, QuantityMaxBaseUnits, QuantityStepBaseUnits int64
	PricingBasis                                                      string
	PricingUnitBaseUnits                                              int64
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
type CatalogVariantResult struct {
	Variant  CatalogVariantRecord
	Replayed bool
}

func HashCatalogProductCreateRequest(input CatalogProductInput) string {
	return hashFacts(input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, optionalProductFact(input.Brand), input.VariantTitle, input.MeasurementKind, input.BaseUnit, strings.Join(input.CategoryIDs, ","), input.IdentifierType, input.IdentifierValue, input.ImageURI)
}
func HashCatalogVerticalCreateRequest(item CommerceVerticalRecord) string {
	return hashFacts("vertical", strings.TrimSpace(item.ID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active))
}
func HashCatalogCategoryCreateRequest(item CatalogCategoryRecord) string {
	return hashFacts("category", strings.TrimSpace(item.ID), strings.TrimSpace(item.VerticalID), strings.TrimSpace(item.ParentCategoryID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active))
}
func HashCatalogProductUpdateRequest(productID string, input CatalogProductUpdateInput, expectedVersion int) string {
	return hashFacts(productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, optionalProductFact(input.Brand), strconv.FormatBool(input.Active), strconv.Itoa(expectedVersion))
}
func HashCatalogVariantCreateRequest(input CatalogVariantInput) string {
	return hashFacts("variant", input.ProductID, input.ID, input.Title, input.MeasurementKind, input.BaseUnit, strconv.FormatBool(input.Active), input.IdentifierType, input.IdentifierValue)
}
func HashCatalogVariantUpdateRequest(variantID string, input CatalogVariantInput, expectedVersion int) string {
	return hashFacts("variant-update", variantID, input.Title, input.MeasurementKind, input.BaseUnit, strconv.FormatBool(input.Active), strconv.Itoa(expectedVersion))
}
func HashCatalogOfferCreateRequest(input CatalogOfferInput) string {
	return hashFacts(input.StoreID, input.VariantID, strconv.FormatInt(input.PriceMinor, 10), input.QuantityPolicy, strconv.FormatInt(input.QuantityMinBaseUnits, 10), strconv.FormatInt(input.QuantityMaxBaseUnits, 10), strconv.FormatInt(input.QuantityStepBaseUnits, 10), input.PricingBasis, strconv.FormatInt(input.PricingUnitBaseUnits, 10))
}
func HashCatalogOfferUpdateRequest(offerID string, input CatalogOfferUpdateInput, expectedVersion int) string {
	return hashFacts(offerID, strconv.FormatInt(input.PriceMinor, 10), strconv.FormatBool(input.Availability), input.PublicationState, input.QuantityPolicy, strconv.FormatInt(input.QuantityMinBaseUnits, 10), strconv.FormatInt(input.QuantityMaxBaseUnits, 10), strconv.FormatInt(input.QuantityStepBaseUnits, 10), input.PricingBasis, strconv.FormatInt(input.PricingUnitBaseUnits, 10), strconv.Itoa(expectedVersion))
}

func CreateCommerceVertical(ctx context.Context, db *sql.DB, item CommerceVerticalRecord, idempotencyKey, requestHash string) (CommerceVerticalResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CommerceVerticalResult{}, err
	}
	var kind, id, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&kind, &id, &storedHash)
	if err == nil {
		if kind != "vertical" || storedHash != requestHash {
			return CommerceVerticalResult{}, ErrCatalogIdempotencyConflict
		}
		item, err = readCommerceVerticalTx(ctx, tx, id)
		if err != nil {
			return CommerceVerticalResult{}, err
		}
		if err = tx.Commit(); err != nil {
			return CommerceVerticalResult{}, err
		}
		return CommerceVerticalResult{Vertical: item, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en,active) VALUES($1,$2,$3,$4)", item.ID, item.NameAr, item.NameEn, item.Active); err != nil {
		return CommerceVerticalResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'vertical',$3)", idempotencyKey, requestHash, item.ID); err != nil {
		return CommerceVerticalResult{}, err
	}
	item, err = readCommerceVerticalTx(ctx, tx, item.ID)
	if err != nil {
		return CommerceVerticalResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CommerceVerticalResult{}, err
	}
	return CommerceVerticalResult{Vertical: item}, nil
}

func CreateCatalogCategory(ctx context.Context, db *sql.DB, item CatalogCategoryRecord, idempotencyKey, requestHash string) (CatalogCategoryRecord, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-registry:"+idempotencyKey); err != nil {
		return CatalogCategoryRecord{}, err
	}
	var kind, id, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT entity_type,entity_id,request_hash FROM dsh.catalog_registry_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&kind, &id, &storedHash)
	if err == nil {
		if kind != "category" || storedHash != requestHash {
			return CatalogCategoryRecord{}, ErrCatalogIdempotencyConflict
		}
		item, err = readCatalogCategoryTx(ctx, tx, id)
		if err != nil {
			return CatalogCategoryRecord{}, err
		}
		if err = tx.Commit(); err != nil {
			return CatalogCategoryRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogCategoryRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_categories(id,vertical_id,parent_category_id,name_ar,name_en,active) VALUES($1,$2,NULLIF($3,''),$4,$5,$6)", item.ID, item.VerticalID, item.ParentCategoryID, item.NameAr, item.NameEn, item.Active); err != nil {
		return CatalogCategoryRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_registry_mutation_idempotency(idempotency_key,request_hash,entity_type,entity_id) VALUES($1,$2,'category',$3)", idempotencyKey, requestHash, item.ID); err != nil {
		return CatalogCategoryRecord{}, err
	}
	item, err = readCatalogCategoryTx(ctx, tx, item.ID)
	if err != nil {
		return CatalogCategoryRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogCategoryRecord{}, err
	}
	return item, nil
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
		return nil, err
	}
	defer rows.Close()
	items := []CommerceVerticalRecord{}
	for rows.Next() {
		var item CommerceVerticalRecord
		if err = rows.Scan(&item.ID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func ReadCommerceVertical(ctx context.Context, db *sql.DB, id string) (CommerceVerticalRecord, error) {
	var item CommerceVerticalRecord
	err := db.QueryRowContext(ctx, "SELECT id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.commerce_verticals WHERE id=$1", strings.TrimSpace(id)).Scan(&item.ID, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CommerceVerticalRecord{}, ErrCatalogVerticalNotFound
	}
	return item, err
}
func ListCatalogCategories(ctx context.Context, db *sql.DB, verticalID string, activeOnly bool) ([]CatalogCategoryRecord, error) {
	where := " WHERE vertical_id=$1"
	if activeOnly {
		where += " AND active=true"
	}
	rows, err := db.QueryContext(ctx, "SELECT id,vertical_id,parent_category_id,name_ar,name_en,active,version,created_at,updated_at FROM dsh.catalog_categories"+where+" ORDER BY parent_category_id NULLS FIRST,lower(name_en),id", strings.TrimSpace(verticalID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CatalogCategoryRecord{}
	for rows.Next() {
		var item CatalogCategoryRecord
		var parent sql.NullString
		if err = rows.Scan(&item.ID, &item.VerticalID, &parent, &item.NameAr, &item.NameEn, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if parent.Valid {
			item.ParentCategoryID = parent.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const catalogProductSelect = `SELECT p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at FROM dsh.catalog_products p`
const catalogOfferSelect = `SELECT o.id,o.store_id,o.variant_id,o.price_minor,o.currency,o.quantity_policy,o.quantity_min_base_units,o.quantity_max_base_units,o.quantity_step_base_units,o.pricing_basis,o.pricing_unit_base_units,o.inventory_policy,o.availability,o.publication_state,o.version,o.created_at,o.updated_at,v.id,v.product_id,v.title,v.measurement_kind,v.base_unit,v.active,v.version,v.created_at,v.updated_at,p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id JOIN dsh.stores s ON s.id=o.store_id`

func ReadCatalogProduct(ctx context.Context, db *sql.DB, productID string) (CatalogProductRecord, error) {
	item, err := readCatalogProductRow(db.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1", strings.TrimSpace(productID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductRecord{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductRecord{}, err
	}
	return hydrateCatalogProduct(ctx, db, item)
}

func ReadCatalogVariant(ctx context.Context, db *sql.DB, variantID string) (CatalogVariantRecord, error) {
	var variant CatalogVariantRecord
	err := db.QueryRowContext(ctx, "SELECT id,product_id,title,measurement_kind,base_unit,active,version,created_at,updated_at FROM dsh.catalog_product_variants WHERE id=$1", strings.TrimSpace(variantID)).Scan(&variant.ID, &variant.ProductID, &variant.Title, &variant.MeasurementKind, &variant.BaseUnit, &variant.Active, &variant.Version, &variant.CreatedAt, &variant.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantRecord{}, ErrCatalogVariantNotFound
	}
	if err != nil {
		return CatalogVariantRecord{}, err
	}
	variant.Identifiers, err = listCatalogIdentifiers(ctx, db, variant.ID)
	if err != nil {
		return CatalogVariantRecord{}, err
	}
	variant.Attributes, err = listVariantAttributes(ctx, db, variant.ID)
	return variant, err
}
func ListCatalogProducts(ctx context.Context, db *sql.DB, query, verticalID string, activeOnly bool, limit int) ([]CatalogProductRecord, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("catalog Product limit is invalid")
	}
	args := []any{}
	where := []string{}
	if activeOnly {
		where = append(where, "p.active=true")
	}
	if verticalID = strings.TrimSpace(verticalID); verticalID != "" {
		args = append(args, verticalID)
		where = append(where, fmt.Sprintf("p.vertical_id=$%d", len(args)))
	}
	if query = strings.TrimSpace(query); query != "" {
		args = append(args, query+"%")
		where = append(where, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, catalogProductSelect+clause+fmt.Sprintf(" ORDER BY lower(p.canonical_name),p.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CatalogProductRecord{}
	for rows.Next() {
		item, err := readCatalogProductRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for i := range items {
		items[i], err = hydrateCatalogProduct(ctx, db, items[i])
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func ListCatalogProductsForPartner(ctx context.Context, db *sql.DB, query, verticalID, partnerActorID string, limit int) ([]CatalogProductRecord, error) {
	if limit < 1 || limit > 100 || strings.TrimSpace(partnerActorID) == "" {
		return nil, errors.New("catalog Product partner listing facts are invalid")
	}
	args := []any{strings.TrimSpace(partnerActorID)}
	where := []string{"(p.scope='SHARED' OR (p.scope='STORE_SCOPED' AND EXISTS (SELECT 1 FROM dsh.stores owned_store WHERE owned_store.id=p.store_id AND owned_store.partner_actor_id=$1)))"}
	if verticalID = strings.TrimSpace(verticalID); verticalID != "" {
		args = append(args, verticalID)
		where = append(where, fmt.Sprintf("p.vertical_id=$%d", len(args)))
	}
	if query = strings.TrimSpace(query); query != "" {
		args = append(args, query+"%")
		where = append(where, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, catalogProductSelect+" WHERE "+strings.Join(where, " AND ")+fmt.Sprintf(" ORDER BY lower(p.canonical_name),p.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogProductRecord, 0)
	for rows.Next() {
		item, scanErr := readCatalogProductRow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range items {
		items[i], err = hydrateCatalogProduct(ctx, db, items[i])
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func validateCatalogProductFactsTx(ctx context.Context, tx *sql.Tx, input CatalogProductInput) error {
	if input.VerticalID == "" || input.CanonicalName == "" || len(input.CategoryIDs) == 0 {
		return errors.New("catalog Product facts are invalid")
	}
	if input.Scope != "SHARED" && input.Scope != "STORE_SCOPED" {
		return errors.New("catalog Product scope is invalid")
	}
	if input.Scope == "SHARED" && input.StoreID != "" {
		return ErrCatalogProductOwnership
	}
	if input.Scope == "STORE_SCOPED" && input.StoreID == "" {
		return ErrCatalogProductOwnership
	}
	if input.MeasurementKind != "DISCRETE" && input.MeasurementKind != "MEASURED" && input.MeasurementKind != "VARIABLE_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.MeasurementKind == "DISCRETE" && input.BaseUnit != "COUNT" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.MeasurementKind != "DISCRETE" && input.BaseUnit != "GRAM" && input.BaseUnit != "MILLILITER" {
		return ErrCatalogOfferQuantityInvalid
	}
	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1", input.VerticalID).Scan(&active); errors.Is(err, sql.ErrNoRows) || !active {
		return ErrCatalogVerticalNotFound
	} else if err != nil {
		return err
	}
	for _, categoryID := range input.CategoryIDs {
		var categoryVertical string
		if err := tx.QueryRowContext(ctx, "SELECT vertical_id FROM dsh.catalog_categories WHERE id=$1 AND active=true", categoryID).Scan(&categoryVertical); errors.Is(err, sql.ErrNoRows) || categoryVertical != input.VerticalID {
			return ErrCatalogCategoryNotFound
		} else if err != nil {
			return err
		}
	}
	if input.IdentifierValue != "" && (input.IdentifierType != "GTIN" && input.IdentifierType != "EAN" && input.IdentifierType != "UPC" && input.IdentifierType != "SKU") {
		return ErrCatalogIdentifierInvalid
	}
	return nil
}

func CreateCatalogProduct(ctx context.Context, db *sql.DB, input CatalogProductInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-product:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.catalog_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, e := readCatalogProductTx(ctx, tx, storedID)
		if e != nil {
			return CatalogProductResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogProductResult{}, e
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	if err = validateCatalogProductFactsTx(ctx, tx, input); err != nil {
		return CatalogProductResult{}, err
	}
	productID := input.ID
	if productID == "" {
		productID, err = newID("product")
		if err != nil {
			return CatalogProductResult{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_products(id,vertical_id,scope,store_id,canonical_name,brand) VALUES($1,$2,$3,NULLIF($4,''),$5,$6)", productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Brand); err != nil {
		return CatalogProductResult{}, err
	}
	variantID := "variant_default_" + productID
	title := input.VariantTitle
	if title == "" {
		title = "الافتراضي"
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit) VALUES($1,$2,$3,$4,$5)", variantID, productID, title, input.MeasurementKind, input.BaseUnit); err != nil {
		return CatalogProductResult{}, err
	}
	for _, categoryID := range input.CategoryIDs {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES($1,$2)", productID, categoryID); err != nil {
			return CatalogProductResult{}, err
		}
	}
	if input.IdentifierValue != "" {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value) VALUES($1,$2,$3)", variantID, input.IdentifierType, input.IdentifierValue); err != nil {
			if isUniqueViolation(err) {
				return CatalogProductResult{}, ErrCatalogDuplicateIdentifier
			}
			return CatalogProductResult{}, err
		}
	}
	if input.ImageURI != "" {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media(product_id,uri,media_role,ordinal) VALUES($1,$2,'primary',0)", productID, input.ImageURI); err != nil {
			return CatalogProductResult{}, err
		}
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, productID, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_created',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10)", idempotencyKey, correlationID, actingActorID, productID, product.Version, requestHash, product.CanonicalName, product.Brand, product.VerticalID, product.Scope); err != nil {
		return CatalogProductResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func UpdateCatalogProduct(ctx context.Context, db *sql.DB, productID string, input CatalogProductUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-product:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,operation FROM dsh.catalog_product_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != productID || operation != "update" {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, e := readCatalogProductTx(ctx, tx, productID)
		if e != nil {
			return CatalogProductResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogProductResult{}, e
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	current, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	if input.Scope != "SHARED" && input.Scope != "STORE_SCOPED" {
		return CatalogProductResult{}, ErrCatalogProductScopeForbidden
	}
	if input.Scope == "SHARED" && input.StoreID != "" {
		return CatalogProductResult{}, ErrCatalogProductOwnership
	}
	if input.Scope == "STORE_SCOPED" && input.StoreID == "" {
		return CatalogProductResult{}, ErrCatalogProductOwnership
	}
	var verticalActive bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM dsh.commerce_verticals WHERE id=$1", input.VerticalID).Scan(&verticalActive); errors.Is(err, sql.ErrNoRows) || !verticalActive {
		return CatalogProductResult{}, ErrCatalogVerticalNotFound
	} else if err != nil {
		return CatalogProductResult{}, err
	}
	var categoryMismatch bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id WHERE pc.product_id=$1 AND (c.vertical_id<>$2 OR NOT c.active))", productID, input.VerticalID).Scan(&categoryMismatch); err != nil {
		return CatalogProductResult{}, err
	}
	if categoryMismatch {
		return CatalogProductResult{}, ErrCatalogCategoryNotFound
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_products SET vertical_id=$2,scope=$3,store_id=NULLIF($4,''),canonical_name=$5,brand=$6,active=$7,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$8", productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Brand, input.Active, expectedVersion); err != nil {
		return CatalogProductResult{}, err
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_mutation_idempotency(idempotency_key,request_hash,product_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, productID, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,request_hash,canonical_name,brand,vertical_id,scope) VALUES('catalog_product_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", idempotencyKey, correlationID, actingActorID, productID, current.Version, product.Version, requestHash, product.CanonicalName, product.Brand, product.VerticalID, product.Scope); err != nil {
		return CatalogProductResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func CreateCatalogVariant(ctx context.Context, db *sql.DB, input CatalogVariantInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogVariantResult, error) {
	if input.ID == "" {
		var err error
		input.ID, err = newID("variant")
		if err != nil {
			return CatalogVariantResult{}, err
		}
	}
	if input.ProductID == "" || input.Title == "" {
		return CatalogVariantResult{}, ErrCatalogVariantNotFound
	}
	if input.MeasurementKind == "DISCRETE" && input.BaseUnit != "COUNT" {
		return CatalogVariantResult{}, ErrCatalogOfferQuantityInvalid
	}
	if input.MeasurementKind != "DISCRETE" && input.BaseUnit != "GRAM" && input.BaseUnit != "MILLILITER" {
		return CatalogVariantResult{}, ErrCatalogOfferQuantityInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-variant:idempotency:"+idempotencyKey); err != nil {
		return CatalogVariantResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,variant_id,operation FROM dsh.catalog_variant_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != input.ID || operation != "create" {
			return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
		}
		variant, readErr := readCatalogVariantTx(ctx, tx, input.ID)
		if readErr != nil {
			return CatalogVariantResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogVariantResult{}, err
		}
		return CatalogVariantResult{Variant: variant, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active) VALUES($1,$2,$3,$4,$5,$6)", input.ID, input.ProductID, input.Title, input.MeasurementKind, input.BaseUnit, input.Active); err != nil {
		return CatalogVariantResult{}, err
	}
	if input.IdentifierValue != "" {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value) VALUES($1,$2,$3)", input.ID, input.IdentifierType, input.IdentifierValue); err != nil {
			if isUniqueViolation(err) {
				return CatalogVariantResult{}, ErrCatalogDuplicateIdentifier
			}
			return CatalogVariantResult{}, err
		}
	}
	variant, err := readCatalogVariantTx(ctx, tx, input.ID)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_mutation_idempotency(idempotency_key,request_hash,variant_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, input.ID, variant.Version); err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_audit(event_type,idempotency_key,correlation_id,acting_actor_id,variant_id,product_id,from_version,result_version,request_hash,title,measurement_kind,base_unit,active) VALUES('catalog_variant_created',$1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11)", idempotencyKey, correlationID, actingActorID, variant.ID, variant.ProductID, variant.Version, requestHash, variant.Title, variant.MeasurementKind, variant.BaseUnit, variant.Active); err != nil {
		return CatalogVariantResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogVariantResult{}, err
	}
	return CatalogVariantResult{Variant: variant}, nil
}
func UpdateCatalogVariant(ctx context.Context, db *sql.DB, variantID string, input CatalogVariantInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogVariantResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" || strings.TrimSpace(actingActorID) == "" {
		return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-variant:idempotency:"+idempotencyKey); err != nil {
		return CatalogVariantResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,variant_id,operation FROM dsh.catalog_variant_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != variantID || operation != "update" {
			return CatalogVariantResult{}, ErrCatalogIdempotencyConflict
		}
		variant, readErr := readCatalogVariantTx(ctx, tx, variantID)
		if readErr != nil {
			return CatalogVariantResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogVariantResult{}, err
		}
		return CatalogVariantResult{Variant: variant, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantResult{}, err
	}
	current, err := readCatalogVariantTx(ctx, tx, variantID)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogVariantResult{}, ErrCatalogVariantNotFound
	}
	if err != nil {
		return CatalogVariantResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogVariantResult{}, ErrCatalogVersionConflict
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_product_variants SET title=$2,measurement_kind=$3,base_unit=$4,active=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$6", variantID, input.Title, input.MeasurementKind, input.BaseUnit, input.Active, expectedVersion); err != nil {
		return CatalogVariantResult{}, err
	}
	variant, err := readCatalogVariantTx(ctx, tx, variantID)
	if err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_mutation_idempotency(idempotency_key,request_hash,variant_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, variantID, variant.Version); err != nil {
		return CatalogVariantResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_variant_audit(event_type,idempotency_key,correlation_id,acting_actor_id,variant_id,product_id,from_version,result_version,request_hash,title,measurement_kind,base_unit,active) VALUES('catalog_variant_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", idempotencyKey, correlationID, actingActorID, variant.ID, variant.ProductID, expectedVersion, variant.Version, requestHash, variant.Title, variant.MeasurementKind, variant.BaseUnit, variant.Active); err != nil {
		return CatalogVariantResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogVariantResult{}, err
	}
	return CatalogVariantResult{Variant: variant}, nil
}

func ListCatalogOffers(ctx context.Context, db *sql.DB, storeID string, publicOnly bool) ([]CatalogStoreOfferRecord, error) {
	where := []string{"o.store_id=$1"}
	if publicOnly {
		where = append(where, customerVisibleOfferConditions()...)
	}
	rows, err := db.QueryContext(ctx, catalogOfferSelect+" WHERE "+strings.Join(where, " AND ")+" ORDER BY o.created_at ASC,o.id", strings.TrimSpace(storeID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CatalogStoreOfferRecord{}
	for rows.Next() {
		item, err := scanCatalogOffer(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range items {
		items[i], err = hydrateCatalogOffer(ctx, db, items[i])
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}
func ReadCatalogOffer(ctx context.Context, db *sql.DB, offerID string) (CatalogStoreOfferRecord, error) {
	item, err := scanCatalogOffer(db.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", strings.TrimSpace(offerID)))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferRecord{}, ErrCatalogOfferNotFound
	}
	if err != nil {
		return CatalogStoreOfferRecord{}, err
	}
	return hydrateCatalogOffer(ctx, db, item)
}
func validateOfferInput(input CatalogOfferInput) error {
	if input.StoreID == "" || input.VariantID == "" || input.PriceMinor <= 0 || input.PricingUnitBaseUnits <= 0 {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.QuantityPolicy != "DISCRETE" && input.QuantityPolicy != "MEASURED" && input.QuantityPolicy != "VARIABLE_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.QuantityMinBaseUnits <= 0 || input.QuantityMaxBaseUnits < input.QuantityMinBaseUnits || input.QuantityStepBaseUnits <= 0 || (input.QuantityMaxBaseUnits-input.QuantityMinBaseUnits)%input.QuantityStepBaseUnits != 0 {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.PricingBasis != "PER_UNIT" && input.PricingBasis != "PER_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	if input.QuantityPolicy == "DISCRETE" {
		if input.PricingBasis != "PER_UNIT" || input.PricingUnitBaseUnits != 1 {
			return ErrCatalogOfferQuantityInvalid
		}
	} else if input.PricingBasis != "PER_MEASURE" {
		return ErrCatalogOfferQuantityInvalid
	}
	return nil
}
func CreateCatalogOffer(ctx context.Context, db *sql.DB, input CatalogOfferInput, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogStoreOfferResult, error) {
	if err := validateOfferInput(input); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-offer:idempotency:"+idempotencyKey); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,offer_id,operation FROM dsh.catalog_store_offer_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "create" {
			return CatalogStoreOfferResult{}, ErrCatalogIdempotencyConflict
		}
		offer, e := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", storedID))
		if e != nil {
			return CatalogStoreOfferResult{}, e
		}
		offer, e = hydrateCatalogOffer(ctx, tx, offer)
		if e != nil {
			return CatalogStoreOfferResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogStoreOfferResult{}, e
		}
		return CatalogStoreOfferResult{Offer: offer, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, err
	}
	var storeVertical, productVertical, productScope, productStore, kind, baseUnit string
	if err = tx.QueryRowContext(ctx, "SELECT s.primary_vertical_id,p.vertical_id,p.scope,COALESCE(p.store_id,''),v.measurement_kind,v.base_unit FROM dsh.stores s JOIN dsh.catalog_product_variants v ON v.id=$2 JOIN dsh.catalog_products p ON p.id=v.product_id WHERE s.id=$1 FOR SHARE", input.StoreID, input.VariantID).Scan(&storeVertical, &productVertical, &productScope, &productStore, &kind, &baseUnit); errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferResult{}, ErrCatalogVariantNotFound
	} else if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if productScope == "STORE_SCOPED" && productStore != input.StoreID {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if storeVertical == "" || productVertical == "" || storeVertical != productVertical {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if input.QuantityPolicy != kind {
		return CatalogStoreOfferResult{}, ErrCatalogOfferQuantityInvalid
	}
	offerID, err := newID("offer")
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_basis,pricing_unit_base_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", offerID, input.StoreID, input.VariantID, input.PriceMinor, input.QuantityPolicy, input.QuantityMinBaseUnits, input.QuantityMaxBaseUnits, input.QuantityStepBaseUnits, input.PricingBasis, input.PricingUnitBaseUnits); err != nil {
		if isUniqueViolation(err) {
			return CatalogStoreOfferResult{}, ErrCatalogOfferAlreadyExists
		}
		return CatalogStoreOfferResult{}, err
	}
	offer, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key,request_hash,offer_id,operation,result_version) VALUES($1,$2,$3,'create',$4)", idempotencyKey, requestHash, offerID, offer.Version); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_audit(event_type,idempotency_key,correlation_id,acting_actor_id,offer_id,from_state,to_state,result_version,request_hash,store_id,variant_id,price_minor,currency,availability) VALUES('catalog_store_offer_created',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12)", idempotencyKey, correlationID, actingActorID, offerID, offer.PublicationState, offer.Version, requestHash, offer.StoreID, offer.VariantID, offer.PriceMinor, offer.Currency, offer.Availability); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	return CatalogStoreOfferResult{Offer: offer}, nil
}
func UpdateCatalogOffer(ctx context.Context, db *sql.DB, offerID string, input CatalogOfferUpdateInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogStoreOfferResult, error) {
	if input.PublicationState != "draft" && input.PublicationState != "published" && input.PublicationState != "hidden" {
		return CatalogStoreOfferResult{}, ErrCatalogOfferInvalidState
	}
	if err := validateOfferInput(CatalogOfferInput{StoreID: "store", VariantID: "variant", PriceMinor: input.PriceMinor, QuantityPolicy: input.QuantityPolicy, QuantityMinBaseUnits: input.QuantityMinBaseUnits, QuantityMaxBaseUnits: input.QuantityMaxBaseUnits, QuantityStepBaseUnits: input.QuantityStepBaseUnits, PricingBasis: input.PricingBasis, PricingUnitBaseUnits: input.PricingUnitBaseUnits}); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-offer:idempotency:"+idempotencyKey); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,offer_id,operation FROM dsh.catalog_store_offer_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != offerID || operation != "update" {
			return CatalogStoreOfferResult{}, ErrCatalogIdempotencyConflict
		}
		offer, e := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
		if e != nil {
			return CatalogStoreOfferResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return CatalogStoreOfferResult{}, e
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
	if input.QuantityPolicy != current.Variant.MeasurementKind {
		return CatalogStoreOfferResult{}, ErrCatalogOfferQuantityInvalid
	}
	if input.PublicationState == "published" && current.Variant.MeasurementKind == "VARIABLE_MEASURE" {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if input.PublicationState == "published" && (!current.Product.Active || !current.Variant.Active || current.Product.VerticalID == "") {
		return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
	}
	if input.PublicationState == "published" {
		var missingRequiredAttribute bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1
			FROM dsh.catalog_product_categories pc
			JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true
			JOIN dsh.catalog_category_attribute_rules r ON r.category_id=c.id AND r.required=true
			JOIN dsh.catalog_attribute_definitions ad ON ad.id=r.attribute_id AND ad.active=true
			WHERE pc.product_id=$1 AND ad.vertical_id=$2
			AND ((r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_variant_attribute_values av WHERE av.variant_id=$3 AND av.attribute_id=r.attribute_id))
				OR (NOT r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_attribute_values av WHERE av.product_id=$1 AND av.attribute_id=r.attribute_id)))
		)`, current.Product.ID, current.Product.VerticalID, current.Variant.ID).Scan(&missingRequiredAttribute); err != nil {
			return CatalogStoreOfferResult{}, err
		}
		if missingRequiredAttribute {
			return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
		}
		var invalidModifierConfiguration bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1
			FROM dsh.catalog_store_offer_modifier_groups og
			JOIN dsh.catalog_modifier_groups mg ON mg.id=og.group_id
			WHERE og.offer_id=$1
			AND (mg.store_id<>$2 OR NOT mg.active OR mg.min_selections > (SELECT COUNT(*) FROM dsh.catalog_modifier_options mo WHERE mo.group_id=mg.id AND mo.availability=true))
		)`, current.ID, current.StoreID).Scan(&invalidModifierConfiguration); err != nil {
			return CatalogStoreOfferResult{}, err
		}
		if invalidModifierConfiguration {
			return CatalogStoreOfferResult{}, ErrCatalogOfferProductDisabled
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET price_minor=$2,quantity_policy=$3,quantity_min_base_units=$4,quantity_max_base_units=$5,quantity_step_base_units=$6,pricing_basis=$7,pricing_unit_base_units=$8,availability=$9,publication_state=$10,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$11", offerID, input.PriceMinor, input.QuantityPolicy, input.QuantityMinBaseUnits, input.QuantityMaxBaseUnits, input.QuantityStepBaseUnits, input.PricingBasis, input.PricingUnitBaseUnits, input.Availability, input.PublicationState, expectedVersion); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	offer, err := scanCatalogOffer(tx.QueryRowContext(ctx, catalogOfferSelect+" WHERE o.id=$1", offerID))
	if err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_mutation_idempotency(idempotency_key,request_hash,offer_id,operation,result_version) VALUES($1,$2,$3,'update',$4)", idempotencyKey, requestHash, offerID, offer.Version); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offer_audit(event_type,idempotency_key,correlation_id,acting_actor_id,offer_id,from_state,to_state,expected_version,result_version,request_hash,store_id,variant_id,price_minor,currency,availability) VALUES('catalog_store_offer_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", idempotencyKey, correlationID, actingActorID, offerID, current.PublicationState, offer.PublicationState, expectedVersion, offer.Version, requestHash, offer.StoreID, offer.VariantID, offer.PriceMinor, offer.Currency, offer.Availability); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogStoreOfferResult{}, err
	}
	return CatalogStoreOfferResult{Offer: offer}, nil
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readCatalogProductRow(row rowScanner) (CatalogProductRecord, error) {
	var item CatalogProductRecord
	var vertical, store, brand sql.NullString
	err := row.Scan(&item.ID, &vertical, &item.Scope, &store, &item.CanonicalName, &brand, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if vertical.Valid {
		item.VerticalID = vertical.String
	}
	if store.Valid {
		item.StoreID = store.String
	}
	item.Brand = nullableString(brand)
	return item, err
}
func hydrateCatalogProduct(ctx context.Context, db queryer, item CatalogProductRecord) (CatalogProductRecord, error) {
	rows, err := db.QueryContext(ctx, "SELECT id,product_id,title,measurement_kind,base_unit,active,version,created_at,updated_at FROM dsh.catalog_product_variants WHERE product_id=$1 ORDER BY id", item.ID)
	if err != nil {
		return item, err
	}
	defer rows.Close()
	item.Variants = []CatalogVariantRecord{}
	for rows.Next() {
		var v CatalogVariantRecord
		if err = rows.Scan(&v.ID, &v.ProductID, &v.Title, &v.MeasurementKind, &v.BaseUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return item, err
		}
		item.Variants = append(item.Variants, v)
	}
	if err = rows.Err(); err != nil {
		return item, err
	}
	if err = rows.Close(); err != nil {
		return item, err
	}
	for i := range item.Variants {
		item.Variants[i].Identifiers, err = listCatalogIdentifiers(ctx, db, item.Variants[i].ID)
		if err != nil {
			return item, err
		}
		item.Variants[i].Attributes, err = listVariantAttributes(ctx, db, item.Variants[i].ID)
		if err != nil {
			return item, err
		}
	}
	cats, err := db.QueryContext(ctx, "SELECT category_id FROM dsh.catalog_product_categories WHERE product_id=$1 ORDER BY category_id", item.ID)
	if err != nil {
		return item, err
	}
	defer cats.Close()
	item.CategoryIDs = []string{}
	for cats.Next() {
		var id string
		if err = cats.Scan(&id); err != nil {
			return item, err
		}
		item.CategoryIDs = append(item.CategoryIDs, id)
	}
	if err = cats.Err(); err != nil {
		return item, err
	}
	if err = cats.Close(); err != nil {
		return item, err
	}
	item.Attributes, err = listProductAttributes(ctx, db, item.ID)
	if err != nil {
		return item, err
	}
	media, err := db.QueryContext(ctx, "SELECT uri,media_role,ordinal FROM dsh.catalog_media WHERE product_id=$1 ORDER BY ordinal", item.ID)
	if err != nil {
		return item, err
	}
	defer media.Close()
	item.Media = []CatalogMediaRecord{}
	for media.Next() {
		var m CatalogMediaRecord
		if err = media.Scan(&m.URI, &m.Role, &m.Ordinal); err != nil {
			return item, err
		}
		item.Media = append(item.Media, m)
	}
	return item, media.Err()
}
func readCatalogProductTx(ctx context.Context, tx *sql.Tx, id string) (CatalogProductRecord, error) {
	item, err := readCatalogProductRow(tx.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1", id))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductRecord{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductRecord{}, err
	}
	return hydrateCatalogProduct(ctx, tx, item)
}
func readCatalogProductTxForUpdate(ctx context.Context, tx *sql.Tx, id string) (CatalogProductRecord, error) {
	return readCatalogProductTx(ctx, tx, id)
}
func readCatalogVariantTx(ctx context.Context, tx *sql.Tx, id string) (CatalogVariantRecord, error) {
	var v CatalogVariantRecord
	err := tx.QueryRowContext(ctx, "SELECT id,product_id,title,measurement_kind,base_unit,active,version,created_at,updated_at FROM dsh.catalog_product_variants WHERE id=$1", id).Scan(&v.ID, &v.ProductID, &v.Title, &v.MeasurementKind, &v.BaseUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return v, err
	}
	v.Identifiers, err = listCatalogIdentifiers(ctx, tx, id)
	if err != nil {
		return v, err
	}
	v.Attributes, err = listVariantAttributes(ctx, tx, id)
	return v, err
}
func listCatalogIdentifiers(ctx context.Context, db queryer, variantID string) ([]CatalogIdentifierRecord, error) {
	rows, err := db.QueryContext(ctx, "SELECT identifier_type,identifier_value FROM dsh.catalog_variant_identifiers WHERE variant_id=$1 ORDER BY id", variantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CatalogIdentifierRecord{}
	for rows.Next() {
		var item CatalogIdentifierRecord
		if err = rows.Scan(&item.Type, &item.Value); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func scanCatalogOffer(row rowScanner) (CatalogStoreOfferRecord, error) {
	var item CatalogStoreOfferRecord
	var v CatalogVariantRecord
	var p CatalogProductRecord
	var vertical, store, brand sql.NullString
	var min, max, step sql.NullInt64
	err := row.Scan(&item.ID, &item.StoreID, &item.VariantID, &item.PriceMinor, &item.Currency, &item.QuantityPolicy, &min, &max, &step, &item.PricingBasis, &item.PricingUnitBaseUnits, &item.InventoryPolicy, &item.Availability, &item.PublicationState, &item.Version, &item.CreatedAt, &item.UpdatedAt, &v.ID, &v.ProductID, &v.Title, &v.MeasurementKind, &v.BaseUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt, &p.ID, &vertical, &p.Scope, &store, &p.CanonicalName, &brand, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return item, err
	}
	if min.Valid {
		item.QuantityMinBaseUnits = &min.Int64
	}
	if max.Valid {
		item.QuantityMaxBaseUnits = &max.Int64
	}
	if step.Valid {
		item.QuantityStepBaseUnits = &step.Int64
	}
	if vertical.Valid {
		p.VerticalID = vertical.String
	}
	if store.Valid {
		p.StoreID = store.String
	}
	p.Brand = nullableString(brand)
	item.Product = p
	item.Variant = v
	return item, nil
}
func hydrateCatalogOffer(ctx context.Context, db queryer, item CatalogStoreOfferRecord) (CatalogStoreOfferRecord, error) {
	var err error
	item.Product.Attributes, err = listProductAttributes(ctx, db, item.Product.ID)
	if err != nil {
		return item, err
	}
	item.Variant.Identifiers, err = listCatalogIdentifiers(ctx, db, item.Variant.ID)
	if err != nil {
		return item, err
	}
	item.Variant.Attributes, err = listVariantAttributes(ctx, db, item.Variant.ID)
	if err != nil {
		return item, err
	}
	item.ModifierGroups, err = listOfferModifierGroups(ctx, db, item.ID)
	return item, err
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
