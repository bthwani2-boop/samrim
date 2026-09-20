package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
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
	ErrCatalogInventoryInvalid      = errors.New("catalog inventory facts are invalid")
	ErrCatalogInventoryInsufficient = errors.New("catalog inventory is insufficient")
	ErrCatalogInventoryReserved     = errors.New("catalog inventory has active reservations")
	ErrCatalogProductScopeForbidden = errors.New("Partner cannot directly create or mutate a Shared Product")
	ErrCatalogProductOwnership      = errors.New("Store-scoped Product ownership is invalid")
	ErrCatalogMediaInvalid          = errors.New("catalog Product media is invalid")
	ErrCatalogProductInvalidCursor  = errors.New("catalog Product cursor is invalid")
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
type CatalogMediaInput struct {
	URI, Role string
	Ordinal   int
}
type CatalogMediaAssetInput struct {
	ID, ProductID, IdempotencyKey, ObjectKey, URI string
	ContentSHA256, ContentType, Role              string
	ExpectedVersion                               int
	ByteSize                                      int64
}
type CatalogMediaAssetRecord struct {
	ID, ProductID, IdempotencyKey, ObjectKey, URI string
	ContentSHA256, ContentType, Role, State       string
	ExpectedVersion                               int
	ByteSize, CleanupAttempts                     int64
	LastCleanupError                              *string
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
	InventoryOnHandBaseUnits, InventoryReservedBaseUnits                      int64
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
	InventoryPolicy                                                   string
	InventoryOnHandBaseUnits                                          int64
}
type CatalogOfferUpdateInput struct {
	PriceMinor                                                        int64
	Availability                                                      bool
	PublicationState, QuantityPolicy                                  string
	QuantityMinBaseUnits, QuantityMaxBaseUnits, QuantityStepBaseUnits int64
	PricingBasis                                                      string
	PricingUnitBaseUnits                                              int64
	InventoryPolicy                                                   string
	InventoryOnHandBaseUnits                                          int64
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
func HashCatalogMediaReplaceRequest(productID string, media []CatalogMediaInput, expectedVersion int) string {
	facts := []string{"media-replace", productID, strconv.Itoa(expectedVersion)}
	for _, item := range media {
		facts = append(facts, item.URI, item.Role, strconv.Itoa(item.Ordinal))
	}
	return hashFacts(facts...)
}
func HashCatalogMediaUploadRequest(productID, role, contentSHA256 string, expectedVersion int) string {
	return hashFacts("media-upload", productID, role, contentSHA256, strconv.Itoa(expectedVersion))
}
func HashCatalogVariantCreateRequest(input CatalogVariantInput) string {
	return hashFacts("variant", input.ProductID, input.ID, input.Title, input.MeasurementKind, input.BaseUnit, strconv.FormatBool(input.Active), input.IdentifierType, input.IdentifierValue)
}
func HashCatalogVariantUpdateRequest(variantID string, input CatalogVariantInput, expectedVersion int) string {
	return hashFacts("variant-update", variantID, input.Title, input.MeasurementKind, input.BaseUnit, strconv.FormatBool(input.Active), strconv.Itoa(expectedVersion))
}
func HashCatalogOfferCreateRequest(input CatalogOfferInput) string {
	return hashFacts(input.StoreID, input.VariantID, strconv.FormatInt(input.PriceMinor, 10), input.QuantityPolicy, strconv.FormatInt(input.QuantityMinBaseUnits, 10), strconv.FormatInt(input.QuantityMaxBaseUnits, 10), strconv.FormatInt(input.QuantityStepBaseUnits, 10), input.PricingBasis, strconv.FormatInt(input.PricingUnitBaseUnits, 10), input.InventoryPolicy, strconv.FormatInt(input.InventoryOnHandBaseUnits, 10))
}
func HashCatalogOfferUpdateRequest(offerID string, input CatalogOfferUpdateInput, expectedVersion int) string {
	return hashFacts(offerID, strconv.FormatInt(input.PriceMinor, 10), strconv.FormatBool(input.Availability), input.PublicationState, input.QuantityPolicy, strconv.FormatInt(input.QuantityMinBaseUnits, 10), strconv.FormatInt(input.QuantityMaxBaseUnits, 10), strconv.FormatInt(input.QuantityStepBaseUnits, 10), input.PricingBasis, strconv.FormatInt(input.PricingUnitBaseUnits, 10), input.InventoryPolicy, strconv.FormatInt(input.InventoryOnHandBaseUnits, 10), strconv.Itoa(expectedVersion))
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
	if item.ID == "" {
		item.ID, err = newID("vertical")
		if err != nil {
			return CommerceVerticalResult{}, err
		}
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
	if item.ID == "" {
		item.ID, err = newID("category")
		if err != nil {
			return CatalogCategoryRecord{}, err
		}
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
const catalogOfferSelect = `SELECT o.id,o.store_id,o.variant_id,o.price_minor,o.currency,o.quantity_policy,o.quantity_min_base_units,o.quantity_max_base_units,o.quantity_step_base_units,o.pricing_basis,o.pricing_unit_base_units,o.inventory_policy,o.inventory_on_hand_base_units,o.inventory_reserved_base_units,o.availability,o.publication_state,o.version,o.created_at,o.updated_at,v.id,v.product_id,v.title,v.measurement_kind,v.base_unit,v.active,v.version,v.created_at,v.updated_at,p.id,p.vertical_id,p.scope,p.store_id,p.canonical_name,p.brand,p.active,p.version,p.created_at,p.updated_at FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id JOIN dsh.stores s ON s.id=o.store_id`

type CatalogProductPage struct {
	Products   []CatalogProductRecord
	NextCursor string
}

type catalogProductCursor struct {
	Version        int    `json:"v"`
	Query          string `json:"q"`
	VerticalID     string `json:"verticalId"`
	ActiveOnly     bool   `json:"activeOnly"`
	PartnerActorID string `json:"partnerActorId,omitempty"`
	CanonicalName  string `json:"canonicalName"`
	ProductID      string `json:"productId"`
}

func encodeCatalogProductCursor(cursor catalogProductCursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeCatalogProductCursor(raw, query, verticalID, partnerActorID string, activeOnly bool) (*catalogProductCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCatalogProductInvalidCursor
	}
	var cursor catalogProductCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.Version != 1 || cursor.CanonicalName == "" || cursor.ProductID == "" || cursor.Query != query || cursor.VerticalID != verticalID || cursor.ActiveOnly != activeOnly || cursor.PartnerActorID != partnerActorID {
		return nil, ErrCatalogProductInvalidCursor
	}
	return &cursor, nil
}

func finishCatalogProductPage(ctx context.Context, db *sql.DB, items []CatalogProductRecord, limit int, cursor catalogProductCursor) (CatalogProductPage, error) {
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	for i := range items {
		var err error
		items[i], err = hydrateCatalogProduct(ctx, db, items[i])
		if err != nil {
			return CatalogProductPage{}, err
		}
	}
	page := CatalogProductPage{Products: items}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		cursor.CanonicalName = strings.ToLower(last.CanonicalName)
		cursor.ProductID = last.ID
		var err error
		page.NextCursor, err = encodeCatalogProductCursor(cursor)
		if err != nil {
			return CatalogProductPage{}, err
		}
	}
	return page, nil
}

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
func ListCatalogProducts(ctx context.Context, db *sql.DB, query, verticalID string, activeOnly bool, limit int, rawCursor string) (CatalogProductPage, error) {
	if limit < 1 || limit > 100 {
		return CatalogProductPage{}, errors.New("catalog Product limit is invalid")
	}
	query = strings.TrimSpace(query)
	verticalID = strings.TrimSpace(verticalID)
	cursor, err := decodeCatalogProductCursor(rawCursor, query, verticalID, "", activeOnly)
	if err != nil {
		return CatalogProductPage{}, err
	}
	args := []any{}
	where := []string{}
	if activeOnly {
		where = append(where, "p.active=true")
	}
	if verticalID != "" {
		args = append(args, verticalID)
		where = append(where, fmt.Sprintf("p.vertical_id=$%d", len(args)))
	}
	if query != "" {
		args = append(args, query+"%")
		where = append(where, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	if cursor != nil {
		args = append(args, cursor.CanonicalName, cursor.ProductID)
		where = append(where, fmt.Sprintf("(lower(p.canonical_name)>$%d OR (lower(p.canonical_name)=$%d AND p.id>$%d))", len(args)-1, len(args)-1, len(args)))
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, catalogProductSelect+clause+fmt.Sprintf(" ORDER BY lower(p.canonical_name),p.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return CatalogProductPage{}, err
	}
	defer rows.Close()
	items := []CatalogProductRecord{}
	for rows.Next() {
		item, err := readCatalogProductRow(rows)
		if err != nil {
			return CatalogProductPage{}, err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return CatalogProductPage{}, err
	}
	pageCursor := catalogProductCursor{Version: 1, Query: query, VerticalID: verticalID, ActiveOnly: activeOnly}
	return finishCatalogProductPage(ctx, db, items, limit, pageCursor)
}

func ListCatalogProductsForPartner(ctx context.Context, db *sql.DB, query, verticalID, partnerActorID string, limit int, rawCursor string) (CatalogProductPage, error) {
	if limit < 1 || limit > 100 || strings.TrimSpace(partnerActorID) == "" {
		return CatalogProductPage{}, errors.New("catalog Product partner listing facts are invalid")
	}
	query = strings.TrimSpace(query)
	verticalID = strings.TrimSpace(verticalID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	cursor, err := decodeCatalogProductCursor(rawCursor, query, verticalID, partnerActorID, false)
	if err != nil {
		return CatalogProductPage{}, err
	}
	args := []any{partnerActorID}
	where := []string{"(p.scope='SHARED' OR (p.scope='STORE_SCOPED' AND EXISTS (SELECT 1 FROM dsh.stores owned_store WHERE owned_store.id=p.store_id AND owned_store.partner_actor_id=$1)))"}
	if verticalID != "" {
		args = append(args, verticalID)
		where = append(where, fmt.Sprintf("p.vertical_id=$%d", len(args)))
	}
	if query != "" {
		args = append(args, query+"%")
		where = append(where, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	if cursor != nil {
		args = append(args, cursor.CanonicalName, cursor.ProductID)
		where = append(where, fmt.Sprintf("(lower(p.canonical_name)>$%d OR (lower(p.canonical_name)=$%d AND p.id>$%d))", len(args)-1, len(args)-1, len(args)))
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, catalogProductSelect+" WHERE "+strings.Join(where, " AND ")+fmt.Sprintf(" ORDER BY lower(p.canonical_name),p.id LIMIT $%d", len(args)), args...)
	if err != nil {
		return CatalogProductPage{}, err
	}
	defer rows.Close()
	items := make([]CatalogProductRecord, 0)
	for rows.Next() {
		item, scanErr := readCatalogProductRow(rows)
		if scanErr != nil {
			return CatalogProductPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CatalogProductPage{}, err
	}
	pageCursor := catalogProductCursor{Version: 1, Query: query, VerticalID: verticalID, PartnerActorID: partnerActorID}
	return finishCatalogProductPage(ctx, db, items, limit, pageCursor)
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
	var result sql.Result
	if result, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_products SET vertical_id=$2,scope=$3,store_id=NULLIF($4,''),canonical_name=$5,brand=$6,active=$7,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$8", productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Brand, input.Active, expectedVersion); err != nil {
		return CatalogProductResult{}, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CatalogProductResult{}, ErrCatalogVersionConflict
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

func ReplaceCatalogProductMedia(ctx context.Context, db *sql.DB, productID string, media []CatalogMediaInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogProductResult, error) {
	return replaceCatalogProductMedia(ctx, db, productID, media, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, nil)
}

func ReplaceCatalogProductMediaWithAsset(ctx context.Context, db *sql.DB, productID string, media []CatalogMediaInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, asset CatalogMediaAssetInput) (CatalogProductResult, error) {
	return replaceCatalogProductMedia(ctx, db, productID, media, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, &asset)
}

func replaceCatalogProductMedia(ctx context.Context, db *sql.DB, productID string, media []CatalogMediaInput, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, asset *CatalogMediaAssetInput) (CatalogProductResult, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogProductResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if strings.TrimSpace(productID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogProductResult{}, ErrCatalogMediaInvalid
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-media:idempotency:"+idempotencyKey); err != nil {
		return CatalogProductResult{}, err
	}
	var storedHash, storedProductID string
	var storedExpectedVersion int
	err = tx.QueryRowContext(ctx, "SELECT request_hash,product_id,expected_version FROM dsh.catalog_media_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedProductID, &storedExpectedVersion)
	if err == nil {
		if storedHash != requestHash || storedProductID != productID || storedExpectedVersion != expectedVersion {
			return CatalogProductResult{}, ErrCatalogIdempotencyConflict
		}
		product, readErr := readCatalogProductTx(ctx, tx, productID)
		if readErr != nil {
			return CatalogProductResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogProductResult{}, err
		}
		return CatalogProductResult{Product: product, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, err
	}
	current, err := readCatalogProductTxForUpdate(ctx, tx, productID)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductResult{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductResult{}, err
	}
	if current.Version != expectedVersion {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	oldMedia, err := listCatalogMedia(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_media WHERE product_id=$1", productID); err != nil {
		return CatalogProductResult{}, err
	}
	for _, item := range media {
		if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media(product_id,uri,media_role,ordinal) VALUES($1,$2,$3,$4)", productID, item.URI, item.Role, item.Ordinal); err != nil {
			return CatalogProductResult{}, err
		}
	}
	if asset != nil {
		result, updateErr := tx.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='active', retired_at=NULL, cleaned_at=NULL, last_cleanup_error=NULL WHERE id=$1 AND product_id=$2 AND idempotency_key=$3 AND object_key=$4 AND uri=$5", asset.ID, asset.ProductID, asset.IdempotencyKey, asset.ObjectKey, asset.URI)
		if updateErr != nil {
			return CatalogProductResult{}, updateErr
		}
		if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
			return CatalogProductResult{}, ErrCatalogMediaInvalid
		}
	}
	newURIs := make(map[string]struct{}, len(media))
	for _, item := range media {
		newURIs[item.URI] = struct{}{}
	}
	for _, item := range oldMedia {
		if _, retained := newURIs[item.URI]; retained {
			continue
		}
		if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='retired', retired_at=COALESCE(retired_at,clock_timestamp()), last_cleanup_error=NULL WHERE product_id=$1 AND uri=$2 AND state='active'", productID, item.URI); err != nil {
			return CatalogProductResult{}, err
		}
	}
	var result sql.Result
	if result, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_products SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2", productID, expectedVersion); err != nil {
		return CatalogProductResult{}, err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return CatalogProductResult{}, ErrCatalogVersionConflict
	}
	product, err := readCatalogProductTx(ctx, tx, productID)
	if err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media_mutation_idempotency(idempotency_key,request_hash,product_id,expected_version,result_version) VALUES($1,$2,$3,$4,$5)", idempotencyKey, requestHash, productID, expectedVersion, product.Version); err != nil {
		return CatalogProductResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media_audit(event_type,idempotency_key,correlation_id,acting_actor_id,product_id,from_version,result_version,media_count,request_hash) VALUES('catalog_media_replaced',$1,$2,$3,$4,$5,$6,$7,$8)", idempotencyKey, correlationID, actingActorID, productID, current.Version, product.Version, len(media), requestHash); err != nil {
		return CatalogProductResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogProductResult{}, err
	}
	return CatalogProductResult{Product: product}, nil
}

func RegisterCatalogMediaAssetPending(ctx context.Context, db *sql.DB, asset CatalogMediaAssetInput) (CatalogMediaAssetRecord, bool, error) {
	if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.ProductID) == "" || strings.TrimSpace(asset.IdempotencyKey) == "" || strings.TrimSpace(asset.ObjectKey) == "" || strings.TrimSpace(asset.URI) == "" || asset.ExpectedVersion < 1 || len(asset.ContentSHA256) != 64 || asset.ByteSize < 1 || asset.ByteSize > 10485760 || (asset.ContentType != "image/jpeg" && asset.ContentType != "image/png") || (asset.Role != "primary" && asset.Role != "gallery") {
		return CatalogMediaAssetRecord{}, false, ErrCatalogMediaInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-media-asset:idempotency:"+asset.IdempotencyKey); err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	stored, err := readCatalogMediaAssetByIdempotencyTx(ctx, tx, asset.IdempotencyKey)
	if err == nil {
		if stored.ProductID != asset.ProductID || stored.ExpectedVersion != asset.ExpectedVersion || stored.ObjectKey != asset.ObjectKey || stored.URI != asset.URI || stored.ContentSHA256 != asset.ContentSHA256 || stored.ContentType != asset.ContentType || stored.Role != asset.Role || stored.ByteSize != asset.ByteSize {
			return CatalogMediaAssetRecord{}, false, ErrCatalogIdempotencyConflict
		}
		if stored.State == "failed" {
			if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='pending', last_cleanup_error=NULL WHERE id=$1", stored.ID); err != nil {
				return CatalogMediaAssetRecord{}, false, err
			}
			stored.State = "pending"
		}
		if err = tx.Commit(); err != nil {
			return CatalogMediaAssetRecord{}, false, err
		}
		return stored, stored.State == "active", nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogMediaAssetRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_media_assets(id,product_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')", asset.ID, asset.ProductID, asset.IdempotencyKey, asset.ExpectedVersion, asset.ObjectKey, asset.URI, asset.ContentSHA256, asset.ContentType, asset.ByteSize, asset.Role); err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogMediaAssetRecord{}, false, err
	}
	return CatalogMediaAssetRecord{ID: asset.ID, ProductID: asset.ProductID, IdempotencyKey: asset.IdempotencyKey, ExpectedVersion: asset.ExpectedVersion, ObjectKey: asset.ObjectKey, URI: asset.URI, ContentSHA256: asset.ContentSHA256, ContentType: asset.ContentType, Role: asset.Role, State: "pending", ByteSize: asset.ByteSize}, false, nil
}

func MarkCatalogMediaAssetFailed(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='failed', cleanup_attempts=cleanup_attempts+1, last_cleanup_error=$2 WHERE id=$1 AND state<>'deleted'", assetID, strings.TrimSpace(message))
	return err
}

func ListCatalogMediaAssetsForCleanup(ctx context.Context, db *sql.DB, limit int) ([]CatalogMediaAssetRecord, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	rows, err := db.QueryContext(ctx, "SELECT id,product_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state,cleanup_attempts,last_cleanup_error FROM dsh.catalog_media_assets WHERE state IN ('retired','failed') OR (state='pending' AND created_at < clock_timestamp() - interval '10 minutes') ORDER BY created_at ASC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]CatalogMediaAssetRecord, 0)
	for rows.Next() {
		var asset CatalogMediaAssetRecord
		if err := rows.Scan(&asset.ID, &asset.ProductID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.Role, &asset.State, &asset.CleanupAttempts, &asset.LastCleanupError); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return assets, nil
}

func MarkCatalogMediaAssetDeleted(ctx context.Context, db *sql.DB, assetID string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET state='deleted', retired_at=COALESCE(retired_at,clock_timestamp()), cleaned_at=clock_timestamp(), cleanup_attempts=cleanup_attempts+1, last_cleanup_error=NULL WHERE id=$1 AND state IN ('retired','failed','pending')", assetID)
	return err
}

func MarkCatalogMediaAssetCleanupFailure(ctx context.Context, db *sql.DB, assetID, message string) error {
	_, err := db.ExecContext(ctx, "UPDATE dsh.catalog_media_assets SET cleanup_attempts=cleanup_attempts+1, last_cleanup_error=$2 WHERE id=$1 AND state IN ('retired','failed','pending')", assetID, strings.TrimSpace(message))
	return err
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
	if input.InventoryPolicy == "" {
		input.InventoryPolicy = "AVAILABILITY_ONLY"
	}
	if input.InventoryPolicy != "AVAILABILITY_ONLY" && input.InventoryPolicy != "QUANTITY_ON_HAND" {
		return ErrCatalogInventoryInvalid
	}
	if input.InventoryOnHandBaseUnits < 0 {
		return ErrCatalogInventoryInvalid
	}
	if input.InventoryPolicy == "AVAILABILITY_ONLY" && input.InventoryOnHandBaseUnits != 0 {
		return ErrCatalogInventoryInvalid
	}
	if input.InventoryPolicy == "QUANTITY_ON_HAND" && input.InventoryOnHandBaseUnits%input.QuantityStepBaseUnits != 0 {
		return ErrCatalogInventoryInvalid
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
	if input.InventoryPolicy == "" {
		input.InventoryPolicy = "AVAILABILITY_ONLY"
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_basis,pricing_unit_base_units,inventory_policy,inventory_on_hand_base_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", offerID, input.StoreID, input.VariantID, input.PriceMinor, input.QuantityPolicy, input.QuantityMinBaseUnits, input.QuantityMaxBaseUnits, input.QuantityStepBaseUnits, input.PricingBasis, input.PricingUnitBaseUnits, input.InventoryPolicy, input.InventoryOnHandBaseUnits); err != nil {
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
	if input.InventoryPolicy == "" {
		input.InventoryPolicy = "AVAILABILITY_ONLY"
	}
	if input.InventoryPolicy != "AVAILABILITY_ONLY" && input.InventoryPolicy != "QUANTITY_ON_HAND" || input.InventoryOnHandBaseUnits < 0 {
		return CatalogStoreOfferResult{}, ErrCatalogInventoryInvalid
	}
	if input.InventoryPolicy == "AVAILABILITY_ONLY" && (input.InventoryOnHandBaseUnits != 0 || current.InventoryReservedBaseUnits != 0) {
		return CatalogStoreOfferResult{}, ErrCatalogInventoryReserved
	}
	if input.InventoryPolicy == "QUANTITY_ON_HAND" && (input.InventoryOnHandBaseUnits < current.InventoryReservedBaseUnits || input.InventoryOnHandBaseUnits%input.QuantityStepBaseUnits != 0) {
		return CatalogStoreOfferResult{}, ErrCatalogInventoryInvalid
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
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_store_offers SET price_minor=$2,quantity_policy=$3,quantity_min_base_units=$4,quantity_max_base_units=$5,quantity_step_base_units=$6,pricing_basis=$7,pricing_unit_base_units=$8,inventory_policy=$9,inventory_on_hand_base_units=$10,inventory_reserved_base_units=CASE WHEN $9='AVAILABILITY_ONLY' THEN 0 ELSE inventory_reserved_base_units END,availability=$11,publication_state=$12,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$13", offerID, input.PriceMinor, input.QuantityPolicy, input.QuantityMinBaseUnits, input.QuantityMaxBaseUnits, input.QuantityStepBaseUnits, input.PricingBasis, input.PricingUnitBaseUnits, input.InventoryPolicy, input.InventoryOnHandBaseUnits, input.Availability, input.PublicationState, expectedVersion); err != nil {
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
	item.Media, err = listCatalogMedia(ctx, db, item.ID)
	if err != nil {
		return item, err
	}
	return item, nil
}

func listCatalogMedia(ctx context.Context, db queryer, productID string) ([]CatalogMediaRecord, error) {
	rows, err := db.QueryContext(ctx, "SELECT uri,media_role,ordinal FROM dsh.catalog_media WHERE product_id=$1 ORDER BY ordinal", productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogMediaRecord, 0)
	for rows.Next() {
		var item CatalogMediaRecord
		if err := rows.Scan(&item.URI, &item.Role, &item.Ordinal); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func readCatalogMediaAssetByIdempotencyTx(ctx context.Context, db queryer, idempotencyKey string) (CatalogMediaAssetRecord, error) {
	var asset CatalogMediaAssetRecord
	var lastCleanupError sql.NullString
	rows, err := db.QueryContext(ctx, "SELECT id,product_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state,cleanup_attempts,last_cleanup_error FROM dsh.catalog_media_assets WHERE idempotency_key=$1", idempotencyKey)
	if err != nil {
		return asset, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return asset, err
		}
		return asset, sql.ErrNoRows
	}
	err = rows.Scan(&asset.ID, &asset.ProductID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.Role, &asset.State, &asset.CleanupAttempts, &lastCleanupError)
	if lastCleanupError.Valid {
		asset.LastCleanupError = &lastCleanupError.String
	}
	return asset, err
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
	item, err := readCatalogProductRow(tx.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1 FOR UPDATE", id))
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogProductRecord{}, ErrCatalogProductNotFound
	}
	if err != nil {
		return CatalogProductRecord{}, err
	}
	return hydrateCatalogProduct(ctx, tx, item)
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
	err := row.Scan(&item.ID, &item.StoreID, &item.VariantID, &item.PriceMinor, &item.Currency, &item.QuantityPolicy, &min, &max, &step, &item.PricingBasis, &item.PricingUnitBaseUnits, &item.InventoryPolicy, &item.InventoryOnHandBaseUnits, &item.InventoryReservedBaseUnits, &item.Availability, &item.PublicationState, &item.Version, &item.CreatedAt, &item.UpdatedAt, &v.ID, &v.ProductID, &v.Title, &v.MeasurementKind, &v.BaseUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt, &p.ID, &vertical, &p.Scope, &store, &p.CanonicalName, &brand, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt)
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
	item.Product.Media, err = listCatalogMedia(ctx, db, item.Product.ID)
	if err != nil {
		return item, err
	}
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
