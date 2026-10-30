package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrCatalogProductNotFound           = errors.New("catalog Product was not found")
	ErrCatalogVariantNotFound           = errors.New("catalog Product Variant was not found")
	ErrCatalogOfferNotFound             = errors.New("catalog StoreOffer was not found")
	ErrCatalogVerticalNotFound          = errors.New("commerce vertical was not found")
	ErrCatalogCategoryNotFound          = errors.New("catalog category was not found")
	ErrCatalogCategoryInvalidCursor     = errors.New("catalog category cursor is invalid")
	ErrCatalogIdempotencyConflict       = errors.New("catalog idempotency key was already used with different facts")
	ErrCatalogRegistryNameConflict      = errors.New("catalog registry name already exists in this scope")
	ErrCatalogVersionConflict           = errors.New("catalog version is stale")
	ErrCatalogAttributeRuleInvalid      = errors.New("catalog attribute rule is invalid")
	ErrCatalogAttributeDefinitionExists = errors.New("catalog attribute definition already exists")
	ErrCatalogAttributeOptionExists     = errors.New("catalog attribute option already exists")
	ErrCatalogCategoryCycle             = errors.New("catalog category parent would create a cycle")
	ErrCatalogCategoryHasActiveChildren = errors.New("active catalog categories cannot be detached from their active parent")
	ErrCatalogCategoryParentInactive    = errors.New("an active catalog category requires an active parent path")
	ErrCatalogDuplicateIdentifier       = errors.New("catalog identifier is already assigned")
	ErrCatalogIdentifierInvalid         = errors.New("catalog identifier is invalid")
	ErrCatalogOfferAlreadyExists        = errors.New("StoreOffer already exists for this Store and Variant")
	ErrCatalogOfferInvalidState         = errors.New("StoreOffer publication state is invalid")
	ErrCatalogOfferProductDisabled      = errors.New("disabled Product or Variant cannot be published")
	ErrCatalogOfferQuantityInvalid      = errors.New("StoreOffer quantity policy is invalid")
	ErrCatalogOfferStoreNotFound        = errors.New("catalog Store was not found")
	ErrCatalogInventoryInvalid          = errors.New("catalog inventory facts are invalid")
	ErrCatalogInventoryInsufficient     = errors.New("catalog inventory is insufficient")
	ErrCatalogInventoryReserved         = errors.New("catalog inventory has active reservations")
	ErrCatalogProductScopeForbidden     = errors.New("Partner cannot directly create or mutate a Shared Product")
	ErrCatalogProductOwnership          = errors.New("Store-scoped Product ownership is invalid")
	ErrCatalogProductScopeMismatch      = errors.New("catalog Product scope or Store ownership is invalid")
	ErrCatalogMediaInvalid              = errors.New("catalog Product media is invalid")
	ErrCatalogProductInvalidCursor      = errors.New("catalog Product cursor is invalid")
)

type CommerceVerticalRecord struct {
	ID, NameAr, NameEn   string
	ImageURI             string
	Active               bool
	Version              int
	CreatedAt, UpdatedAt time.Time
}
type CatalogCategoryRecord struct {
	ID, VerticalID, ParentCategoryID, NameAr, NameEn string
	ImageURI                                         string
	Active                                           bool
	Version                                          int
	CreatedAt, UpdatedAt                             time.Time
}
type CatalogCategoryListItem struct {
	CatalogCategoryRecord
	PathAr      string
	PathEn      string
	sortNameKey string
}
type CatalogCategoryPage struct {
	Categories []CatalogCategoryListItem
	NextCursor string
}
type UpdateCommerceVerticalInput struct {
	NameAr, NameEn  string
	Active          bool
	ExpectedVersion int
}
type UpdateCatalogCategoryInput struct {
	ParentCategoryID string
	NameAr, NameEn   string
	Active           bool
	ExpectedVersion  int
}
type CatalogIdentifierRecord struct{ Type, Value string }
type CatalogMediaRecord struct {
	AssetID, URI, Role string
	Ordinal            int
}
type CatalogMediaInput struct {
	AssetID, Role string
	Ordinal       int
}
type CatalogMediaAssetInput struct {
	ID, ProductID, IdempotencyKey, ObjectKey, URI       string
	ContentSHA256, ContentType, Role, RequestHash       string
	Creator, SourceDescription, SourceURI               string
	RightsStatement, RightsURI, RightsAttestedByActorID string
	ExpectedVersion                                     int
	ByteSize                                            int64
}
type CatalogMediaAssetRecord struct {
	ID, ProductID, IdempotencyKey, ObjectKey, URI        string
	ContentSHA256, ContentType, Role, State, RequestHash string
	ExpectedVersion                                      int
	ByteSize, CleanupAttempts                            int64
	LastCleanupError                                     *string
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
	ID, VerticalID, Scope, StoreID, CanonicalName, Description string
	Brand                                                      *string
	Active                                                     bool
	Version                                                    int
	Variants                                                   []CatalogVariantRecord
	CategoryIDs                                                []string
	Attributes                                                 []CatalogAttributeValueRecord
	Media                                                      []CatalogMediaRecord
	CreatedAt, UpdatedAt                                       time.Time
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
	StoreName                                                                 string
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
	ID, VerticalID, Scope, StoreID, CanonicalName, Description string
	Brand                                                      *string
	VariantTitle, MeasurementKind, BaseUnit                    string
	CategoryIDs                                                []string
	AttributeValues, VariantAttributeValues                    []CatalogAttributeValueInput
	IdentifierType, IdentifierValue                            string
}
type CatalogProductUpdateInput struct {
	VerticalID, Scope, StoreID, CanonicalName, Description string
	Brand                                                  *string
	Active                                                 bool
	CategoryIDs                                            []string
	AttributeValues                                        []CatalogAttributeValueInput
	VariantAttributeValues                                 []CatalogVariantAttributeValueSet
}
type CatalogVariantAttributeValueSet struct {
	VariantID string
	Values    []CatalogAttributeValueInput
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

type CatalogRegistryAuditInput struct {
	EntityType       string
	EntityID         string
	Action           string
	ActingActorID    string
	CorrelationID    string
	Reason           string
	ExpectedVersion  int
	ResultingVersion int
	BeforeState      any
	AfterState       any
}

func writeCatalogRegistryAudit(ctx context.Context, tx *sql.Tx, input CatalogRegistryAuditInput) error {
	beforeState, err := json.Marshal(input.BeforeState)
	if err != nil {
		return err
	}
	afterState, err := json.Marshal(input.AfterState)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_registry_audit_events(entity_type,entity_id,action,acting_actor_id,correlation_id,reason,expected_version,resulting_version,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,'null')::jsonb,$10::jsonb)`, input.EntityType, input.EntityID, input.Action, input.ActingActorID, input.CorrelationID, input.Reason, input.ExpectedVersion, input.ResultingVersion, string(beforeState), string(afterState))
	return err
}

type CatalogVariantResult struct {
	Variant  CatalogVariantRecord
	Replayed bool
}

func HashCatalogProductCreateRequest(input CatalogProductInput) string {
	attributeFacts, _ := json.Marshal(struct{ Product, Variant []CatalogAttributeValueInput }{input.AttributeValues, input.VariantAttributeValues})
	return hashFacts(input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Description, optionalProductFact(input.Brand), input.VariantTitle, input.MeasurementKind, input.BaseUnit, strings.Join(input.CategoryIDs, ","), string(attributeFacts), input.IdentifierType, input.IdentifierValue)
}
func HashCatalogVerticalCreateRequest(item CommerceVerticalRecord, reason string) string {
	return hashFacts("vertical", strings.TrimSpace(item.ID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active), strings.TrimSpace(reason))
}
func HashCatalogCategoryCreateRequest(item CatalogCategoryRecord, reason string) string {
	return hashFacts("category", strings.TrimSpace(item.ID), strings.TrimSpace(item.VerticalID), strings.TrimSpace(item.ParentCategoryID), strings.TrimSpace(item.NameAr), strings.TrimSpace(item.NameEn), strconv.FormatBool(item.Active), strings.TrimSpace(reason))
}
func HashCatalogVerticalUpdateRequest(id string, input UpdateCommerceVerticalInput, reason string) string {
	return hashFacts("vertical-update", strings.TrimSpace(id), strings.TrimSpace(input.NameAr), strings.TrimSpace(input.NameEn), strconv.FormatBool(input.Active), strconv.Itoa(input.ExpectedVersion), strings.TrimSpace(reason))
}
func HashCatalogCategoryUpdateRequest(id string, input UpdateCatalogCategoryInput, reason string) string {
	return hashFacts("category-update", strings.TrimSpace(id), strings.TrimSpace(input.ParentCategoryID), strings.TrimSpace(input.NameAr), strings.TrimSpace(input.NameEn), strconv.FormatBool(input.Active), strconv.Itoa(input.ExpectedVersion), strings.TrimSpace(reason))
}
func HashCatalogCategoryAttributeRuleRequest(rule CatalogAttributeRuleRecord, expectedVersion int, reason string) string {
	return hashFacts("category-attribute-rule", strings.TrimSpace(rule.CategoryID), strings.TrimSpace(rule.AttributeID), strconv.FormatBool(rule.Required), strconv.FormatBool(rule.Filterable), strconv.FormatBool(rule.VariantAxis), strconv.Itoa(expectedVersion), strings.TrimSpace(reason))
}
func HashCatalogProductUpdateRequest(productID string, input CatalogProductUpdateInput, expectedVersion int) string {
	categoryFacts, _ := json.Marshal(input.CategoryIDs)
	attributeFacts, _ := json.Marshal(struct {
		Product  []CatalogAttributeValueInput
		Variants []CatalogVariantAttributeValueSet
	}{input.AttributeValues, input.VariantAttributeValues})
	return hashFacts(productID, input.VerticalID, input.Scope, input.StoreID, input.CanonicalName, input.Description, optionalProductFact(input.Brand), strconv.FormatBool(input.Active), string(categoryFacts), string(attributeFacts), strconv.Itoa(expectedVersion))
}
func HashCatalogMediaReplaceRequest(productID string, media []CatalogMediaInput, expectedVersion int) string {
	facts := []string{"media-replace", productID, strconv.Itoa(expectedVersion)}
	for _, item := range media {
		facts = append(facts, item.AssetID, item.Role, strconv.Itoa(item.Ordinal))
	}
	return hashFacts(facts...)
}
func HashCatalogMediaUploadRequest(productID, role, contentSHA256 string, expectedVersion int, provenanceFacts ...string) string {
	facts := []string{"media-upload", productID, role, contentSHA256, strconv.Itoa(expectedVersion)}
	facts = append(facts, provenanceFacts...)
	return hashFacts(facts...)
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
func HashCatalogQuickPriceUpdateRequest(offerID string, priceMinor int64, expectedVersion int) string {
	return hashFacts("quick-price-update", strings.TrimSpace(offerID), strconv.FormatInt(priceMinor, 10), strconv.Itoa(expectedVersion))
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readCatalogProductRow(row rowScanner) (CatalogProductRecord, error) {
	var item CatalogProductRecord
	var vertical, store, brand sql.NullString
	err := row.Scan(&item.ID, &vertical, &item.Scope, &store, &item.CanonicalName, &item.Description, &brand, &item.Active, &item.Version, &item.CreatedAt, &item.UpdatedAt)
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
		item.Variants[i].Identifiers, err = listCatalogIdentifiers(ctx, db, item.Variants[i].ID, item.StoreID)
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
	rows, err := db.QueryContext(ctx, `SELECT asset.id,asset.uri,media.media_role,media.ordinal
		FROM dsh.catalog_media media
		JOIN dsh.catalog_media_assets asset ON asset.product_id=media.product_id AND asset.id=media.media_asset_id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL
		WHERE media.product_id=$1 ORDER BY media.ordinal`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CatalogMediaRecord, 0)
	for rows.Next() {
		var item CatalogMediaRecord
		if err := rows.Scan(&item.AssetID, &item.URI, &item.Role, &item.Ordinal); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func readCatalogMediaAssetByIdempotencyTx(ctx context.Context, db queryer, idempotencyKey string) (CatalogMediaAssetRecord, error) {
	var asset CatalogMediaAssetRecord
	var lastCleanupError sql.NullString
	rows, err := db.QueryContext(ctx, "SELECT id,product_id,idempotency_key,expected_version,object_key,uri,content_sha256,content_type,byte_size,media_role,state,cleanup_attempts,last_cleanup_error,request_hash FROM dsh.catalog_media_assets WHERE idempotency_key=$1", idempotencyKey)
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
	err = rows.Scan(&asset.ID, &asset.ProductID, &asset.IdempotencyKey, &asset.ExpectedVersion, &asset.ObjectKey, &asset.URI, &asset.ContentSHA256, &asset.ContentType, &asset.ByteSize, &asset.Role, &asset.State, &asset.CleanupAttempts, &lastCleanupError, &asset.RequestHash)
	if lastCleanupError.Valid {
		asset.LastCleanupError = &lastCleanupError.String
	}
	return asset, err
}

func readCatalogProductTx(ctx context.Context, tx *sql.Tx, id string) (CatalogProductRecord, error) {
	item, err := readCatalogProductRow(tx.QueryRowContext(ctx, catalogProductSelect+" WHERE p.id=$1 AND p.deleted_at IS NULL", id))
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
	var storeID string
	err := tx.QueryRowContext(ctx, "SELECT v.id,v.product_id,v.title,v.measurement_kind,v.base_unit,v.active,v.version,v.created_at,v.updated_at,COALESCE(p.store_id,'') FROM dsh.catalog_product_variants v JOIN dsh.catalog_products p ON p.id=v.product_id WHERE v.id=$1", id).Scan(&v.ID, &v.ProductID, &v.Title, &v.MeasurementKind, &v.BaseUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt, &storeID)
	if err != nil {
		return v, err
	}
	v.Identifiers, err = listCatalogIdentifiers(ctx, tx, id, storeID)
	if err != nil {
		return v, err
	}
	v.Attributes, err = listVariantAttributes(ctx, tx, id)
	return v, err
}
func listCatalogIdentifiers(ctx context.Context, db queryer, variantID, storeID string) ([]CatalogIdentifierRecord, error) {
	rows, err := db.QueryContext(ctx, "SELECT identifier_type,identifier_value FROM dsh.catalog_variant_identifiers WHERE variant_id=$1 AND (identifier_type<>'SKU' OR store_id=$2) ORDER BY id", variantID, strings.TrimSpace(storeID))
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

func identifierStoreScope(identifierType, storeID string) any {
	if identifierType != "SKU" {
		return nil
	}
	return strings.TrimSpace(storeID)
}
func scanCatalogOffer(row rowScanner) (CatalogStoreOfferRecord, error) {
	var item CatalogStoreOfferRecord
	var v CatalogVariantRecord
	var p CatalogProductRecord
	var vertical, store, brand sql.NullString
	var min, max, step sql.NullInt64
	err := row.Scan(&item.ID, &item.StoreID, &item.VariantID, &item.PriceMinor, &item.Currency, &item.QuantityPolicy, &min, &max, &step, &item.PricingBasis, &item.PricingUnitBaseUnits, &item.InventoryPolicy, &item.InventoryOnHandBaseUnits, &item.InventoryReservedBaseUnits, &item.Availability, &item.PublicationState, &item.Version, &item.CreatedAt, &item.UpdatedAt, &v.ID, &v.ProductID, &v.Title, &v.MeasurementKind, &v.BaseUnit, &v.Active, &v.Version, &v.CreatedAt, &v.UpdatedAt, &p.ID, &vertical, &p.Scope, &store, &p.CanonicalName, &brand, &p.Active, &p.Version, &p.CreatedAt, &p.UpdatedAt, &item.StoreName)
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
	item.Variant.Identifiers, err = listCatalogIdentifiers(ctx, db, item.Variant.ID, item.StoreID)
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

// catalogRegistryNameWriteError maps only known registry label uniqueness failures;
// unrelated unique violations (including IDs and idempotency) remain distinct.
func catalogRegistryNameWriteError(err error) error {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23505" {
		switch pqErr.Constraint {
		case "commerce_verticals_name_ar_uq", "commerce_verticals_name_en_uq",
			"commercial_store_types_vertical_name_ar_uq", "commercial_store_types_vertical_name_en_uq",
			"catalog_categories_sibling_name_ar_uq", "catalog_categories_sibling_name_en_uq", "catalog_shopping_shortcuts_vertical_title_uq":
			return ErrCatalogRegistryNameConflict
		}
	}
	return err
}
